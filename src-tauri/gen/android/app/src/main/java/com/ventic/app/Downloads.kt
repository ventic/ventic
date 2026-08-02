package com.ventic.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeps downloading while the app is off screen, and says so in the shade.
 *
 * The engine is librqbit on this app's own tokio runtime, *inside this process* —
 * so "the user opened another app" and "the download stopped" are one event:
 * Android caches a process with nothing visible in it and then freezes it, and a
 * frozen process has no threads left to talk to peers with. There is no setting
 * or flag for that; a foreground service is the documented exemption, and a
 * foreground service is by definition one with a notification.
 *
 * It polls the engine's own HTTP API instead of being told what to show by the
 * page. The webview's timers are throttled to a crawl the moment it is off
 * screen — which is exactly when this notification is the only thing the user can
 * see — so anything the frontend pushed would freeze at whatever it last said.
 *
 * Foreground only while something is actually downloading: the notification is
 * gone while you browse the library, and the wake lock with it.
 */
class DownloadService : Service() {
  private companion object {
    const val CHANNEL = "downloads"
    const val NOTIFICATION = 1

    /** The same engine the frontend talks to — `ENGINE` in app/utils/torrents.ts. */
    const val ENGINE = "http://127.0.0.1:3030"

    /** Roughly the frontend's own poll, which is what the numbers come from. */
    const val EVERY_MS = 3000L
  }

  private var worker: Thread? = null
  private var lock: PowerManager.WakeLock? = null

  @Volatile
  private var running = true
  private var foreground = false

  override fun onCreate() {
    super.onCreate()
    NotificationManagerCompat.from(this).createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName("Downloads")
        .setDescription("Progress of downloads running in the background")
        .build()
    )
    lock = getSystemService(PowerManager::class.java)
      ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ventic:downloads")
      ?.apply { setReferenceCounted(false) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (worker == null) {
      worker = Thread(::loop, "ventic-downloads").apply { isDaemon = true; start() }
    }
    // The activity re-sends this as it leaves the screen (see MainActivity):
    // the promotion below only succeeds while the app still counts as
    // foreground itself, so that tick must not wait out the sleep.
    worker?.interrupt()

    // Restarting this service after a process death would bring up a poller
    // with no engine to poll — the engine boots with the activity, not here.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    worker?.interrupt()
    worker = null
    idle()
    super.onDestroy()
  }

  /**
   * Android 15 and up cap a `dataSync` service at six hours a day and call this
   * when the budget is gone; not standing down here is a crash.
   *
   * Six hours covers any download this app starts. A torrent still
   * going after that keeps downloading for as long as the app stays on screen,
   * and resumes when it is opened again — the engine persists its state either
   * way. Only a genuinely multi-day download needs more, and the type that has
   * no cap (`specialUse`) has to be justified to Play instead.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    idle()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun loop() {
    while (running) {
      poll()?.let(::show)
      try {
        Thread.sleep(EVERY_MS)
      }
      catch (_: InterruptedException) {
        // Nudged by onStartCommand — poll now rather than in three seconds.
      }
    }
  }

  /** Active downloads, as the notification wants them. */
  private class Snapshot(val count: Int, val name: String, val percent: Int, val mibps: Double)

  private fun poll(): Snapshot? {
    val body = get("$ENGINE/torrents?with_stats=true") ?: return null
    val list = try {
      JSONObject(body).optJSONArray("torrents")
    }
    catch (_: Exception) {
      null
    } ?: return null

    var count = 0
    var have = 0L
    var total = 0L
    var mibps = 0.0
    var name = ""
    for (i in 0 until list.length()) {
      val torrent = list.optJSONObject(i) ?: continue
      val stats = torrent.optJSONObject("stats") ?: continue
      // Mirrors torrentStatus() in stores/downloads.ts: an error, a pause or a
      // finished torrent is nothing to hold a wake lock for. Seeding included —
      // uploading costs the swarm nothing if we sleep, and the user asked for a
      // download, not a server.
      if (!stats.isNull("error") || stats.optString("state") == "paused" ||
        stats.optBoolean("finished")
      ) {
        continue
      }
      count++
      have += stats.optLong("progress_bytes")
      total += stats.optLong("total_bytes")
      mibps += stats.optJSONObject("live")
        ?.optJSONObject("download_speed")
        ?.optDouble("mbps", 0.0) ?: 0.0
      if (name.isEmpty()) name = torrent.optString("name")
    }

    val percent = if (total > 0L) (have * 100 / total).toInt() else 0
    return Snapshot(count, name, percent, mibps)
  }

  private fun show(state: Snapshot) {
    if (state.count == 0) {
      idle()
      return
    }

    val note = notification(state)
    if (foreground) {
      NotificationManagerCompat.from(this).notify(NOTIFICATION, note)
    }
    else {
      try {
        ServiceCompat.startForeground(
          this, NOTIFICATION, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
        foreground = true
      }
      catch (_: Exception) {
        // API 31+ refuses a promotion once the app is in the background, which
        // is the download that started in the last three seconds before the
        // user left. Nothing to recover: the next visit to the app promotes it.
        return
      }
    }

    // A foreground service is not a wake lock — with the screen off the CPU
    // still suspends, and the download with it. Re-taken every tick, with a
    // timeout, so a poller that dies cannot leave it held.
    lock?.acquire(EVERY_MS * 20)
  }

  /** Out of the shade, off the wake lock, still polling in case work arrives. */
  private fun idle() {
    if (foreground) {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      foreground = false
    }
    lock?.takeIf { it.isHeld }?.release()
  }

  private fun notification(state: Snapshot): Notification {
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val speed = String.format("%.1f MiB/s", state.mibps)
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(
        if (state.count > 1) "Downloading ${state.count} torrents" else state.name.ifEmpty { "Downloading" }
      )
      .setContentText("${state.percent}% · $speed")
      // Nothing is known about the size until the metadata is in, and a bar
      // stuck at zero reads as broken.
      .setProgress(100, state.percent, state.percent == 0)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .build()
  }

  private fun get(url: String): String? = try {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 2000
      connection.readTimeout = 2000
      connection.inputStream.bufferedReader().use { it.readText() }
    }
    finally {
      connection.disconnect()
    }
  }
  catch (_: Exception) {
    // The engine comes up a moment after the app does, and is gone once the
    // process is on its way out. Neither is worth a log line every three seconds.
    null
  }
}
