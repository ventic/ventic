package com.ventic.app

import android.Manifest
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.os.storage.StorageManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var web: WebView? = null
  private var player: VenticPlayer? = null

  companion object {
    /** Largest file FAT32 can address: 4 GiB, less one byte. */
    private const val FAT32_MAX = 4L * 1024 * 1024 * 1024 - 1

    /** The new build, in this app's own folder — nothing else may read it. */
    private const val UPDATE_APK = "update.apk"
  }

  /** DownloadManager's id for the APK being fetched, or -1 for none. */
  private var updateId = -1L

  /** Whether the installer has already been opened for that file. */
  private var updateHandedOver = false

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

    onBackPressedDispatcher.addCallback(this, backToPage)
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
    //
    // Posted, not called: wry hands the webview to this hook and only *then*
    // applies `backgroundColor` from tauri.conf.json (main_pipe.rs), so a plain
    // call here is overwritten by the ground colour a few lines later and the
    // webview is opaque for the life of the process — a film plays with sound,
    // subtitles and a clock, and the picture is never seen. The post runs after
    // wry's whole create block. The window keeps its own ventic_ground behind
    // the page, which is what the desktop asks `backgroundColor` for anyway.
    webView.post { webView.setBackgroundColor(Color.TRANSPARENT) }

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

    // And then take the process with it, because a half-live one is worse than
    // no process at all: wry starts the Rust side once per process and never
    // again (see `leave`), so an activity that is really gone must not leave the
    // event loop, the tokio runtime and a librqbit session holding port 3030
    // behind for the next launch to attach itself to. `run()` is written for a
    // cold start and only for a cold start; this is what guarantees it gets one.
    //
    // `isFinishing` keeps it off the path where Android is destroying the
    // activity in order to rebuild it — a configuration change, or reclaiming a
    // backgrounded app it means to restore.
    if (isFinishing && !isChangingConfigurations) {
      Process.killProcess(Process.myPid())
    }
  }

  /**
   * The things the page cannot ask for itself: a WebView implements neither the
   * Fullscreen API nor `screen.orientation.lock`, so the player calls in here
   * when it opens and again when it closes — and Chromium never shipped
   * `navigator.connection.type`, so nor can it tell mobile data from Wi-Fi.
   *
   * Nothing but our own frontend is ever loaded into this webview, which is what
   * makes `installUpdate` acceptable here: it is https-only and ends at the
   * system installer, which asks the user and refuses anything not signed with
   * this app's key. Nothing in here reads anything belonging to the user.
   */
  /**
   * Open the installer on the APK we just downloaded.
   *
   * A `content://` URI through the FileProvider, because a `file://` one has
   * been a FileUriExposedException since API 24 — the package installer is
   * another app, and this is how a file is lent to one.
   */
  private fun installApk() {
    val file = java.io.File(getExternalFilesDir(null), UPDATE_APK)
    runCatching {
      startActivity(
        Intent(Intent.ACTION_VIEW)
          .setDataAndType(
            FileProvider.getUriForFile(this, "$packageName.fileprovider", file),
            "application/vnd.android.package-archive",
          )
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }

  /**
   * The per-app "install unknown apps" switch, which is the only thing standing
   * between a downloaded APK and the installer.
   *
   * Two fallbacks, for the same reason `openStorageSettings` has one: a set-top
   * box often ships a cut-down Settings, and a dead button on a TV is worse than
   * a general settings screen the user can find their way around.
   */
  private fun askInstallPermission() {
    val intents = mutableListOf<Intent>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      intents.add(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")),
      )
      intents.add(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
    }
    intents.add(Intent(Settings.ACTION_SECURITY_SETTINGS))
    intents.add(Intent(Settings.ACTION_SETTINGS))
    for (intent in intents) {
      if (runCatching { startActivity(intent) }.isSuccess) return
    }
  }

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
            .put("writable", true).put("maxFile", maxFile(dir, free)),
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
            .put("writable", false).put("maxFile", 0),
        )
      }
      return out.toString()
    }

    /**
     * The largest single file this drive will hold, or 0 for "no limit worth
     * mentioning". FAT32 stops at 4 GiB, and FAT32 is what a TV formats a stick
     * as when its kernel has nothing better — so this is the common case, not an
     * exotic one, and a film that goes over it fails halfway through the
     * download with an error from the middle of the engine.
     *
     * Measured, not guessed: nothing an app is allowed to read says what
     * filesystem a volume holds (SELinux blocks /proc/filesystems, FUSE hides
     * the type of the mount). Growing an empty file past the limit answers it in
     * one syscall — the length is metadata on every filesystem here, so this
     * writes no data and takes no measurable time.
     */
    private fun maxFile(dir: java.io.File, free: Long): Long {
      // Under a cap there isn't room to reach, the cap decides nothing, and this
      // also keeps a full disk from reading as a small-file limit.
      if (free <= FAT32_MAX) return 0L
      val probe = java.io.File(dir, ".ventic-size-probe")
      return try {
        java.io.RandomAccessFile(probe, "rw").use { it.setLength(FAT32_MAX + 1) }
        0L
      } catch (e: java.io.IOException) {
        FAT32_MAX
      } finally {
        probe.delete()
      }
    }

    /**
     * Android's own storage screen, where a drive can be erased and formatted.
     *
     * This is the whole answer to "what format does my stick need". An app can
     * neither format a drive nor adopt one — both are system-only — but the
     * system's own wizard reformats it in whatever this device actually
     * supports, which no app can work out for itself: `/proc/filesystems` is
     * denied to us by SELinux, and FUSE hides the real type of a mounted volume.
     * So we hand the user to the one screen that knows, rather than guessing a
     * filesystem name at them.
     *
     * False if nothing handles either intent, and the caller keeps its written
     * instructions on screen instead.
     */
    @JavascriptInterface
    fun openStorageSettings(): Boolean {
      // The generic settings screen is a poor second, but it beats a dead
      // button on a set-top box that ships its own cut-down Settings.
      for (action in listOf(Settings.ACTION_INTERNAL_STORAGE_SETTINGS, Settings.ACTION_SETTINGS)) {
        val ok = runCatching { startActivity(Intent(action)) }.isSuccess
        if (ok) return true
      }
      return false
    }

    /**
     * Fetch a new build of Ventic and hand it to Android's package installer.
     *
     * There is no updater plugin on Android and there could not be one: an app
     * cannot overwrite its own APK, only ask the system to install one, and the
     * install is a screen the user confirms. So this is the whole of it —
     * download the file, then open the installer on it — and the "keeps your
     * library" part is Android's, not ours: the package manager only replaces a
     * package with one signed by the same key, and keeps its data when it does.
     *
     * DownloadManager rather than a thread and a stream: it survives this
     * activity, follows the redirect chain from the release URL, and puts a
     * progress notification in the shade for free.
     *
     * Returns "" when the download has started, or the reason it did not —
     * "permission" for the one the user has to grant on a settings screen we
     * have just opened for them.
     */
    @JavascriptInterface
    fun installUpdate(url: String): String {
      // The installer refuses to hear from an app that is not on the "install
      // unknown apps" list (API 26+), and that switch is the user's to flip on a
      // screen only the system can show. Asked here rather than at launch,
      // because this is the one moment it means anything.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
        runOnUiThread { askInstallPermission() }
        return "permission"
      }
      // The bytes about to be handed to the package installer, so: TLS or
      // nothing. (Android's own signature check would reject a swapped-in APK
      // anyway — this is the belt to that braces.)
      if (!url.startsWith("https://")) return "insecure"

      // A cancelled install prompt leaves a perfectly good file behind, and BACK
      // on a remote is one keypress from cancelling one — so offer that file
      // again rather than fetching a hundred megabytes a second time. The flag
      // is only ever set once a download finished, which makes it exactly the
      // question "is the APK already here".
      if (updateHandedOver) {
        updateHandedOver = false
        return ""
      }

      val manager = getSystemService(DownloadManager::class.java) ?: return "unavailable"
      // Whatever a previous attempt left behind, including a half-written file
      // from a download that was cancelled mid-flight.
      if (updateId >= 0) runCatching { manager.remove(updateId) }
      updateId = -1L
      updateHandedOver = false
      runCatching { java.io.File(getExternalFilesDir(null), UPDATE_APK).delete() }

      return runCatching {
        updateId = manager.enqueue(
          DownloadManager.Request(Uri.parse(url))
            .setTitle("Ventic")
            .setDescription("Downloading the update")
            .setDestinationInExternalFilesDir(this@MainActivity, null, UPDATE_APK)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED),
        )
        ""
      }.getOrElse { "failed" }
    }

    /**
     * How that download is going, as JSON: `status` is one of downloading,
     * installing, failed or idle, and `progress` is 0–1 where the server said
     * how big the file is.
     *
     * Opening the installer happens here, on the poll that sees the download
     * finish, rather than from a broadcast receiver: from API 29 a background
     * process may not start an activity at all, so the attempt would be
     * swallowed exactly when the user is not looking. Polled, it fires the next
     * time they are — and the completed download's own notification installs it
     * too, for the times they get there first.
     */
    @JavascriptInterface
    fun updateProgress(): String {
      val manager = getSystemService(DownloadManager::class.java)
      if (updateId < 0 || manager == null) return JSONObject().put("status", "idle").toString()

      val out = JSONObject()
      manager.query(DownloadManager.Query().setFilterById(updateId)).use { row ->
        if (!row.moveToFirst()) return out.put("status", "failed").toString()
        val done = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
        // -1 until the server sends a length, which is what makes the bar
        // indeterminate rather than stuck at zero.
        val total = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
        if (total > 0) out.put("progress", done.toDouble() / total)

        val state = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        if (state == DownloadManager.STATUS_SUCCESSFUL && !updateHandedOver) {
          updateHandedOver = true
          runOnUiThread { installApk() }
        }
        out.put(
          "status",
          when (state) {
            DownloadManager.STATUS_SUCCESSFUL -> "installing"
            DownloadManager.STATUS_FAILED -> "failed"
            else -> "downloading"
          },
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

  /**
   * Wry's own BACK handling, off — this is the line that makes `backToPage`
   * below mean anything.
   *
   * `WryActivity.setWebView` registers a second `OnBackPressedCallback` of its
   * own whenever this is true, and it does one thing: `webView.goBack()`. The
   * dispatcher runs the *last* enabled callback added, and ours goes on in
   * `onCreate` while wry's goes on when the webview is created — later, so it
   * won. `window.__tvBack` was therefore never called with anything open: BACK
   * popped a history entry instead of closing the dialog, the select or the
   * player's subtitle panel in front of it. It only looked right because a
   * history pop and a page-level back are the same thing when there is nothing
   * open, and because at the root `canGoBack()` is false — which is the one case
   * wry hands on, and so the one case that worked.
   */
  override val handleBackNavigation: Boolean = false

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

  /**
   * BACK, from a remote's key and a phone's gesture alike.
   *
   * The dispatcher rather than `onKeyDown`, because the two are not one
   * mechanism: an app targeting API 35+ gets predictive back, where the system
   * routes BACK through `OnBackInvokedDispatcher` and `onKeyDown` is never
   * called at all. That is why Android 15 phones closed the app from wherever
   * they were — a dialog, the middle of a film — while the same build behaved on
   * a TV box two versions older. `OnBackPressedDispatcher` is fed by both paths
   * on every version we support, so the rule lives in one place instead of two
   * that have to agree.
   *
   * `evaluateJavascript` is asynchronous and this callback is not, so it always
   * claims the key and acts on the answer when it arrives. The page decides what
   * back means (close a dialog, leave the player, go back a page) and answers
   * "true" when it handled it; anything else means we are at the root.
   */
  private val backToPage = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      val webView = web
      if (webView == null) {
        leave()
        return
      }
      webView.evaluateJavascript("window.__tvBack ? window.__tvBack() : false") { handled ->
        if (handled != "true") {
          leave()
        }
      }
    }
  }

  /**
   * Back at the root screen, with nothing left to go back to.
   *
   * Deliberately not `finish()`. Finishing the activity does not end the
   * process — Android caches it — and wry starts our Rust `run()` exactly once
   * per process, off a `ProcessLifecycleOwner` observer that ignores a second
   * registration. So reopening the app a few seconds later built a fresh
   * activity onto an event loop whose webview had already been torn down, and
   * the JNI callbacks along that path unwrap their way into a panic, which
   * aborts the process. "I closed it and opened it again and it just crashed"
   * was this, and it needs no unusual device to reproduce — only a relaunch fast
   * enough that Android still had the old process.
   *
   * Backgrounding the task is what every other Android app does with back at the
   * root anyway: the app is left where it was, a download keeps running, and
   * reopening is instant. Genuinely closing it is the Recents swipe, which
   * destroys the activity — see `onDestroy`.
   */
  private fun leave() {
    moveTaskToBack(true)
  }
}
