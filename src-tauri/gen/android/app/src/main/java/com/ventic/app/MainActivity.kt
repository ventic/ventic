package com.ventic.app

import android.Manifest
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.StatFs
import android.os.storage.StorageManager
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var web: WebView? = null
  private var player: VenticPlayer? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // DownloadService runs whether or not this is granted — the permission only
    // decides whether its notification is drawn, and that notification is the
    // only sign a background download is still going. Asked once, at launch,
    // because nothing here knows when a download is about to start.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
    }
  }

  /**
   * Both halves of keeping downloads alive off screen — see DownloadService.
   *
   * `onResume`, because Android is free to stop an idle background service while
   * we are away, and `onPause`, because a service may only promote itself to a
   * foreground service while its app still counts as foreground (API 31+), and
   * this is the last moment at which that is true.
   */
  override fun onResume() {
    super.onResume()
    nudgeDownloads()
  }

  override fun onPause() {
    super.onPause()
    nudgeDownloads()
  }

  private fun nudgeDownloads() {
    // Never worth a crash on the way out of the app: without it downloads simply
    // stop when the app does, which is where this started.
    runCatching { startService(Intent(this, DownloadService::class.java)) }
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView

    // Playback is ExoPlayer (Player.kt), but the <video> element is still the
    // fallback if that bridge ever fails to come up. The webview won't start one
    // with sound until it has seen a gesture *it* handled, and every gesture on
    // the way to a film — a card, a menu row, the play button — is one the page
    // handled, so none of them count. Without this a film opens and sits paused.
    webView.settings.mediaPlaybackRequiresUserGesture = false

    // ExoPlayer's picture is a SurfaceView underneath this webview, so the page
    // has to be able to show through to it. Only the player route ever makes
    // itself transparent (see MpvPlayer.vue); every other screen paints its own
    // background as before, so nothing else changes.
    webView.setBackgroundColor(Color.TRANSPARENT)

    // A TV reports a 960dp-wide display (1080p at density 2), so the page lays
    // itself out as if on a small laptop and every card, control and line of
    // text arrives at twice the size it wants to be on a screen across the room.
    // Widening the viewport is what un-zooms it: the layout gets 1280px to work
    // with, which is also the width the desktop layout is designed around. The
    // page asks for that width itself (see isTv in utils/platform.ts) — the meta
    // tag it sets is ignored unless the wide viewport is enabled here.
    if (isTv()) {
      webView.settings.useWideViewPort = true
      // Both, or the width does nothing useful: the first lets the page ask for
      // a viewport wider than the display, the second scales that viewport down
      // to fit. With only the first, the layout is 1280 wide and the right 320
      // of it is simply off the side of the screen.
      webView.settings.loadWithOverviewMode = true
    }

    webView.addJavascriptInterface(Screen(), "VenticScreen")
    player = VenticPlayer(this).also { webView.addJavascriptInterface(it, "VenticPlayer") }
  }

  /** Is this a television rather than a phone? Android's own answer, not a guess. */
  private fun isTv(): Boolean =
    getSystemService(android.app.UiModeManager::class.java)?.currentModeType ==
      android.content.res.Configuration.UI_MODE_TYPE_TELEVISION

  override fun onDestroy() {
    player?.release()
    player = null
    // Closing the app stops its downloads; backgrounding it does not. The other
    // way round leaves a notification the user has no way to get rid of, and the
    // engine resumes every torrent where it left off on the next launch anyway.
    runCatching { stopService(Intent(this, DownloadService::class.java)) }
    super.onDestroy()
  }

  /**
   * The things the page cannot ask for itself: a WebView implements neither the
   * Fullscreen API nor `screen.orientation.lock`, so the player calls in here
   * when it opens and again when it closes — and Chromium never shipped
   * `navigator.connection.type`, so nor can it tell mobile data from Wi-Fi.
   *
   * Nothing but our own frontend is ever loaded into this webview. One method
   * sets the window up, the other answers a single bit about the network;
   * neither reads anything belonging to the user.
   */
  inner class Screen {
    /**
     * Does the network we are on charge for bytes? True for mobile data and for
     * a metered Wi-Fi hotspot, which is the distinction a data cap actually
     * cares about — and the one `navigator.connection` cannot make. False when
     * there is no network at all, where nothing is downloading anyway.
     */
    @JavascriptInterface
    fun metered(): Boolean =
      getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: false

    /**
     * Is this a television? The page can't tell — a TV webview's user agent says
     * Android like any phone's — and the difference decides how wide the layout
     * should be and which controls are worth showing at all.
     */
    @JavascriptInterface
    fun tv(): Boolean = isTv()

    /**
     * Every drive this app may write a film to, as JSON — the built-in storage
     * and whatever is plugged into the USB port. A TV box ships with a couple of
     * gigabytes to its name, so a stick is often the only thing on it that can
     * hold one at all, and there is no folder chooser on Android to find it with.
     *
     * Only the app's own directory on each volume qualifies. Everything else on
     * a removable drive is reachable through SAF alone, which hands back a
     * `content://` URI, and the torrent engine writes through a file path; these
     * also need no permission. The catch is the usual one for app-specific
     * storage: uninstalling takes the downloads with it.
     *
     * A drive we cannot write to is listed too, with `writable` false and no
     * path. `getExternalFilesDirs` drops a volume whose folder it failed to
     * create and says nothing about it, which is exactly what an NTFS stick in a
     * TV is: mounted read-only, because these kernels can only read NTFS. Left
     * out, a stick the box itself lists everywhere is missing here for no
     * visible reason; listed, the storage screen can say "format it as exFAT".
     */
    @JavascriptInterface
    fun volumes(): String {
      val storage = getSystemService(StorageManager::class.java)
      val out = JSONArray()
      val usable = HashSet<String?>()
      for (dir in getExternalFilesDirs(null).filterNotNull()) {
        // A card slot with nothing in it still gets an entry, pointing at a path
        // that isn't there.
        if (Environment.getExternalStorageState(dir) != Environment.MEDIA_MOUNTED) continue
        val volume = runCatching { storage?.getStorageVolume(dir) }.getOrNull()
        // Built-in storage is the one volume with no UUID, and never removable,
        // so it can't be mistaken for a stick below.
        usable.add(volume?.uuid)
        val name = runCatching { volume?.getDescription(this@MainActivity) }.getOrNull() ?: dir.path
        val free = runCatching { StatFs(dir.path).availableBytes }.getOrDefault(0L)
        out.put(
          JSONObject().put("name", name).put("path", dir.path).put("free", free)
            .put("writable", true),
        )
      }

      for (volume in runCatching { storage?.storageVolumes }.getOrNull().orEmpty()) {
        if (!volume.isRemovable || volume.uuid in usable) continue
        // Every way a drive can be plugged in and useless, because each one
        // looks identical from the sofa — nothing appears. `mounted` is here
        // because a read-only mount often reports itself as plain mounted and
        // only fails at the mkdir, and `unmountable` because a TV that has no
        // driver for the filesystem never gets as far as a mount at all.
        if (volume.state !in setOf(
            Environment.MEDIA_MOUNTED,
            Environment.MEDIA_MOUNTED_READ_ONLY,
            Environment.MEDIA_UNMOUNTABLE,
            Environment.MEDIA_NOFS,
          )
        ) {
          continue
        }
        val name = runCatching { volume.getDescription(this@MainActivity) }.getOrNull()
        out.put(
          JSONObject().put("name", name ?: "USB drive").put("path", "").put("free", 0)
            .put("writable", false),
        )
      }
      return out.toString()
    }

    @JavascriptInterface
    fun setPlayerMode(on: Boolean) {
      runOnUiThread {
        // A phone held upright turns the film the right way up. A TV is
        // landscape already and ignores this.
        requestedOrientation = if (on) {
          ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
          ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }

        // Two hours of film is two hours of no input on a phone, which the
        // screen timeout reads as nobody being there.
        if (on) {
          window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        val bars = WindowCompat.getInsetsController(window, web ?: window.decorView)
        if (on) {
          bars.hide(WindowInsetsCompat.Type.systemBars())
          // A swipe brings them back for as long as it takes to use them,
          // rather than dropping out of fullscreen for the rest of the film.
          bars.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
          bars.show(WindowInsetsCompat.Type.systemBars())
        }
      }
    }
  }

  // TauriActivity switches wry's own back handling off, so without this the
  // remote's BACK key closes the app from any screen — and it's the most used
  // key on a TV remote. The page decides what back means there (close a dialog,
  // leave the player, go back a page) and answers "true" when it handled it;
  // anything else means we're at the root and quitting is right.
  /**
   * OK is the other key the page can't see for itself. The WebView turns
   * DPAD_CENTER into a click on a link or a button, and drops it entirely for
   * the readonly `<input>` Vuetify builds a select out of — so on a TV, OK on a
   * dropdown did nothing at all and down was the only way to open one.
   *
   * It has to be caught here rather than in `onKeyDown`: the WebView has focus
   * and claims the key, so the activity's own key handling never runs. The page
   * opens what it can and answers false for everything else, and the key is
   * passed on either way — the WebView's handling is what makes OK work
   * everywhere it already does.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
      web?.evaluateJavascript("window.__tvOk ? window.__tvOk() : false", null)
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    val webView = web
    if (keyCode != KeyEvent.KEYCODE_BACK || webView == null) {
      return super.onKeyDown(keyCode, event)
    }

    webView.evaluateJavascript("window.__tvBack ? window.__tvBack() : false") { handled ->
      if (handled != "true") {
        finish()
      }
    }
    return true
  }
}
