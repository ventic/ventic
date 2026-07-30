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

    webView.addJavascriptInterface(Screen(), "VenticScreen")
    player = VenticPlayer(this).also { webView.addJavascriptInterface(it, "VenticPlayer") }
  }

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
     */
    @JavascriptInterface
    fun volumes(): String {
      val storage = getSystemService(StorageManager::class.java)
      val out = JSONArray()
      for (dir in getExternalFilesDirs(null).filterNotNull()) {
        // A card slot with nothing in it still gets an entry, pointing at a path
        // that isn't there.
        if (Environment.getExternalStorageState(dir) != Environment.MEDIA_MOUNTED) continue
        val name = runCatching {
          storage?.getStorageVolume(dir)?.getDescription(this@MainActivity)
        }.getOrNull() ?: dir.path
        val free = runCatching { StatFs(dir.path).availableBytes }.getOrDefault(0L)
        out.put(JSONObject().put("name", name).put("path", dir.path).put("free", free))
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
