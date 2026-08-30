package com.ventic.app

import android.graphics.Color
import android.media.AudioManager
import android.media.MediaCodecList
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Playback on Android, on the device's own decoders.
 *
 * The webview's `<video>` is the wrong engine here. Chromium is built with Dolby
 * (AC-3, E-AC-3, TrueHD) and DTS switched off whatever the hardware underneath
 * can do, so a release carrying one plays as a picture with no sound — on a TV
 * box that decodes it in hardware, and even plugged into a receiver that would
 * have taken the bitstream untouched. ExoPlayer talks to MediaCodec directly, so
 * it gets the device's real decoder set, and hands Dolby straight out over HDMI
 * where an amplifier is listening.
 *
 * It answers the same command/property protocol mpv does (`player_ipc` /
 * `player_props`) and the same one `app/utils/htmlvideo.ts` speaks, so
 * `MpvPlayer.vue` drives all three backends through one code path. This produces
 * a picture, some sound and a clock; the page keeps drawing its own controls,
 * OSD and subtitle cues over the top.
 *
 * The picture is a SurfaceView *below* the webview, showing through it — see
 * MainActivity for the transparency that makes that work, and `sub-text` below
 * for why the player's own subtitle view stays hidden.
 *
 * ExoPlayer may only be touched from the main thread, and a JavascriptInterface
 * is called from a binder thread. So every write is posted, and every read comes
 * off a snapshot the main thread refreshes on a tick.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class VenticPlayer(private val activity: MainActivity) {
  private val main = Handler(Looper.getMainLooper())

  private var player: ExoPlayer? = null
  private var view: PlayerView? = null

  /** Where a `track-list` id points. Main thread only, rebuilt with the snapshot. */
  private class Slot(val group: Tracks.Group, val index: Int, val type: Int)

  private var slots: List<Slot> = emptyList()

  /** mpv keeps volume and mute apart, and the element has no mute at all. */
  private var vol = 100
  private var muted = false
  private var cues = ""

  /**
   * Where mpv has a filter graph, this has the platform's audio effects — and
   * an effect attaches to an audio *session*, so we generate one up front and
   * hand it to ExoPlayer rather than waiting for the one it picks at first play.
   * That way the settings can be applied before there is any audio, and they
   * survive every file this player opens.
   */
  private val session by lazy {
    activity.getSystemService(AudioManager::class.java).generateAudioSessionId()
  }

  private var loudness: LoudnessEnhancer? = null
  private var equalizer: Equalizer? = null

  /**
   * Decode audio with FFmpeg instead of the device's own decoder.
   *
   * Off until the platform has actually failed — see `onPlayerError`. The
   * hardware path is the one that can hand a Dolby bitstream straight to a
   * receiver over HDMI, and `FfmpegAudioRenderer` answers FORMAT_HANDLED
   * without ever asking whether the sink could have passed the stream through,
   * so preferring it from the start would quietly end passthrough for every TV
   * that has it.
   */
  private var softwareAudio = false

  /** The file being played, so the software retry can re-open it. */
  private var opened = ""

  /** Target gain in millibels — see `audio-normalize` in setProp. */
  private var gainMb = 0

  /** How much to lift the speech band by, also in millibels. */
  private var dialogueMb = 0

  @Volatile
  private var snap = JSONObject()

  @Volatile
  private var running = false

  @Volatile
  private var failure: String? = null

  private val tick = object : Runnable {
    override fun run() {
      refresh()
      main.postDelayed(this, 100)
    }
  }

  // -------------------------------------------------------------------------
  // The protocol
  // -------------------------------------------------------------------------

  @JavascriptInterface
  fun start(url: String) {
    failure = null
    running = true
    cues = ""
    opened = url
    // Each film gets its own go on the hardware: one bad E-AC-3 track must not
    // cost every later one its passthrough. At most one retry per file — the
    // flag is set before the rebuild, so a second failure surfaces normally.
    softwareAudio = false
    onMain {
      val p = ensure()
      view?.visibility = View.VISIBLE
      p.setMediaItem(MediaItem.fromUri(url))
      p.prepare()
      p.play()
      main.removeCallbacks(tick)
      tick.run()
    }
  }

  @JavascriptInterface
  fun stop() {
    running = false
    onMain {
      main.removeCallbacks(tick)
      player?.stop()
      player?.clearMediaItems()
      // A SurfaceView left attached keeps its hole punched through the page,
      // which would be a black rectangle over whatever is shown next.
      view?.visibility = View.GONE
      snap = JSONObject()
    }
  }

  @JavascriptInterface
  fun command(json: String): String {
    val cmd = JSONArray(json)
    if (cmd.optString(0) == "set_property") {
      val name = cmd.optString(1)
      val value = cmd.opt(2)
      onMain { setProp(name, value) }
    }
    // `sub-add` never reaches here: external subtitles are downloaded, parsed
    // and drawn by the page (utils/subtitles.ts), so the shim answers it itself.
    return "null"
  }

  @JavascriptInterface
  fun props(names: String): String {
    val want = JSONArray(names)
    val from = snap
    val out = JSONObject()
    for (i in 0 until want.length()) {
      val key = want.optString(i)
      // Absent rather than null for anything we can't produce, which is what mpv
      // does for a property it has no answer for.
      if (from.has(key)) out.put(key, from.get(key))
    }
    return out.toString()
  }

  @JavascriptInterface
  fun status(): String =
    JSONObject().put("running", running).put("log_tail", failure ?: JSONObject.NULL).toString()

  /**
   * Every mime type this device can decode, straight from the platform.
   *
   * This is the honest answer to "will that release play here", and it differs
   * wildly across the targets: an Android TV box almost always has E-AC-3 and
   * HEVC, a mid-range phone often has neither. `isAwkward` in utils/torrents.ts
   * asks this before demoting a release, so a TV stops being told it can't have
   * the Dolby copy it can in fact play.
   */
  @JavascriptInterface
  fun codecs(): String {
    val out = JSONArray()
    for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
      if (info.isEncoder) continue
      for (type in info.supportedTypes) out.put(type.lowercase())
    }
    return out.toString()
  }

  fun release() {
    onMain {
      main.removeCallbacks(tick)
      runCatching { loudness?.release() }
      runCatching { equalizer?.release() }
      loudness = null
      equalizer = null
      player?.release()
      player = null
      view = null
    }
  }

  // -------------------------------------------------------------------------
  // The player itself
  // -------------------------------------------------------------------------

  private fun ensure(): ExoPlayer {
    player?.let { return it }

    val p = ExoPlayer.Builder(activity)
      .setRenderersFactory(
        DefaultRenderersFactory(activity)
          // MediaCodec first, until it has proved it can't — see `softwareAudio`.
          .setExtensionRendererMode(
            if (softwareAudio) {
              DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER
            } else {
              DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON
            },
          )
          // Cheap TV boxes advertise decoders that then fail to initialise.
          .setEnableDecoderFallback(true),
      )
      .build()

    p.audioSessionId = session
    p.setWakeMode(C.WAKE_MODE_LOCAL)
    p.addListener(object : Player.Listener {
      override fun onPlayerError(error: PlaybackException) {
        if (retryInSoftware(error)) return
        running = false
        failure = describe(error)
      }

      override fun onPlaybackStateChanged(state: Int) {
        // Played out. The page decides whether that was the end of the film or a
        // failure, from where the clock stopped — same as the other backends.
        if (state == Player.STATE_ENDED) running = false
      }

      override fun onCues(cueGroup: CueGroup) {
        cues = cueGroup.cues.mapNotNull { it.text?.toString() }.joinToString("\n").trim()
      }
    })

    view?.let { existing ->
      existing.player = p
      player = p
      return p
    }

    val v = PlayerView(activity).apply {
      useController = false
      resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
      setShutterBackgroundColor(Color.BLACK)
      // The bars around a film that doesn't fill the screen. Without this the
      // window's own background (@color/ventic_ground) shows there, so a 4:3
      // film sat in two stripes of the app's grey. The view is GONE unless
      // something is playing, so nothing else goes black.
      setBackgroundColor(Color.BLACK)
      // The page draws every cue itself, in the size, colour and position the
      // user set under Settings → Subtitles. Two renderers would double them up.
      subtitleView?.visibility = View.GONE
      visibility = View.GONE
    }
    v.player = p

    // Index 0: under the webview, which is what lets the page's controls sit
    // over the picture instead of the other way round.
    activity.findViewById<ViewGroup>(android.R.id.content).addView(
      v,
      0,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    view = v
    player = p
    return p
  }

  /**
   * A decoder that said yes and then died, given one more go in software.
   *
   * Android answers `format_supported=YES` for E-AC-3 on a device whose only
   * decoder is the vendor's, then that decoder rejects the first frame of a
   * stream FFmpeg decodes without a complaint. There is no second decoder for
   * `setEnableDecoderFallback` to reach for and often no second audio track
   * either, so one frame ended the whole film — which is what "it plays in
   * other apps" meant, since every other player carries FFmpeg.
   *
   * So: hardware first, and this once the hardware has actually failed. Posted
   * rather than run here because releasing a player inside its own listener is
   * asking for trouble, and `softwareAudio` is set before the post so a second
   * error on the way down cannot start a third attempt.
   */
  private fun retryInSoftware(error: PlaybackException): Boolean {
    val decoding = error.errorCode in
      PlaybackException.ERROR_CODE_DECODER_INIT_FAILED..
      PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
    if (softwareAudio || !decoding || opened.isEmpty() || !FfmpegLibrary.isAvailable()) {
      return false
    }

    softwareAudio = true
    val at = player?.currentPosition ?: 0L
    main.post {
      val old = player
      player = null
      slots = emptyList()
      old?.release()

      val p = ensure()
      p.volume = if (muted) 0f else vol / 100f
      p.setMediaItem(MediaItem.fromUri(opened))
      p.prepare()
      if (at > 0) p.seekTo(at)
      p.play()
    }
    return true
  }

  private fun setProp(name: String, value: Any?) {
    val p = player ?: return
    when (name) {
      "pause" -> if (value == true) p.pause() else p.play()
      "time-pos" -> p.seekTo((num(value, 0.0) * 1000).toLong())
      "volume" -> {
        vol = num(value, 100.0).toInt().coerceIn(0, 100)
        muted = false
        p.volume = vol / 100f
      }
      "mute" -> {
        muted = value == true
        p.volume = if (muted) 0f else vol / 100f
      }
      "speed" -> p.setPlaybackSpeed(num(value, 1.0).toFloat().coerceAtLeast(0.1f))
      "aid" -> select(value, C.TRACK_TYPE_AUDIO)
      "sid" -> select(value, C.TRACK_TYPE_TEXT)
      // Neither of these is an mpv property: mpv is sent a filter chain built
      // in utils/audio.ts, and the backends that have no filters are sent the
      // setting itself to do what they can with. See `audioProps` there.
      "audio-normalize" -> {
        gainMb = when (value) {
          "light" -> 300
          "medium" -> 700
          "strong" -> 1200
          else -> 0
        }
        effects()
      }
      "dialogue-boost" -> {
        dialogueMb = (num(value, 0.0) * 100).toInt()
        effects()
      }
    }
  }

  /**
   * Levelling and the dialogue boost, as far as Android will do them.
   *
   * `LoudnessEnhancer` is a compressor with one knob — a target gain it reaches
   * by bringing the quiet parts up rather than by turning everything up — which
   * is the shape of the levelling setting, if not its range. The dialogue boost
   * has no centre channel to work on here (the effect sits after the mix, on
   * the stereo pair the device is playing), so it is the speech band lifted
   * with the platform equaliser, which is what the stereo case does under mpv
   * too.
   *
   * Both are allowed to fail and both are meant to: a device may ship no effect
   * library at all, and one passing Dolby through to a receiver has no PCM in
   * this process to filter. A film is not worth losing over a volume setting.
   *
   * ponytail: DynamicsProcessing (API 28) is the upgrade — a real multiband
   * compressor with a limiter — if the enhancer's fixed one proves too blunt.
   */
  private fun effects() {
    try {
      val le = loudness ?: LoudnessEnhancer(session).also { loudness = it }
      le.setTargetGain(gainMb)
      le.setEnabled(gainMb > 0)
    } catch (_: Throwable) {
      loudness = null
    }

    try {
      val eq = equalizer ?: Equalizer(0, session).also { equalizer = it }
      // 2 kHz, in the millihertz the effect is addressed in. getBand answers
      // with the band that owns it, or -1 on a device whose bands stop short.
      val band = if (dialogueMb > 0) eq.getBand(2_000_000).toInt() else -1
      if (band >= 0) {
        val ceiling = eq.bandLevelRange[1].toInt()
        eq.setBandLevel(band.toShort(), dialogueMb.coerceAtMost(ceiling).toShort())
      }
      eq.setEnabled(band >= 0)
    } catch (_: Throwable) {
      equalizer = null
    }
  }

  /** mpv's `aid`/`sid`: a `track-list` id, or "no" for off. */
  private fun select(value: Any?, type: Int) {
    val p = player ?: return
    val slot = slots.getOrNull(num(value, 0.0).toInt() - 1)?.takeIf { it.type == type }
    val b = p.trackSelectionParameters.buildUpon().clearOverridesOfType(type)
    p.trackSelectionParameters = if (slot == null) {
      b.setTrackTypeDisabled(type, true).build()
    } else {
      b.setTrackTypeDisabled(type, false)
        .addOverride(TrackSelectionOverride(slot.group.mediaTrackGroup, slot.index))
        .build()
    }
  }

  /**
   * One pass over everything the page polls, built on the main thread so the
   * bridge can answer from any other one.
   */
  private fun refresh() {
    val p = player ?: return

    val found = ArrayList<Slot>()
    val list = JSONArray()
    var aid: Any = "no"
    var sid: Any = "no"

    for (group in p.currentTracks.groups) {
      val kind = when (group.type) {
        C.TRACK_TYPE_AUDIO -> "audio"
        C.TRACK_TYPE_TEXT -> "sub"
        else -> continue
      }
      for (i in 0 until group.length) {
        // A track this device cannot open is not worth offering in the menu.
        if (!group.isTrackSupported(i)) continue
        val f = group.getTrackFormat(i)
        found.add(Slot(group, i, group.type))
        list.put(
          JSONObject()
            .put("id", found.size)
            .put("type", kind)
            .put("lang", f.language ?: JSONObject.NULL)
            .put("title", f.label ?: label(f)),
        )
        if (group.isTrackSelected(i)) {
          if (group.type == C.TRACK_TYPE_AUDIO) aid = found.size else sid = found.size
        }
      }
    }
    slots = found

    val duration = if (p.duration == C.TIME_UNSET) 0.0 else p.duration / 1000.0
    snap = JSONObject()
      .put("pause", !p.playWhenReady)
      .put("paused-for-cache", p.playbackState == Player.STATE_BUFFERING && p.playWhenReady)
      .put("duration", duration)
      .put("time-pos", p.currentPosition / 1000.0)
      .put("demuxer-cache-time", p.bufferedPosition / 1000.0)
      .put("volume", vol)
      .put("mute", muted)
      .put("speed", p.playbackParameters.speed.toDouble())
      .put("track-list", list)
      .put("aid", aid)
      .put("sid", sid)
      .put("sub-text", cues)
  }

  /** "EAC3 5.1" — enough to tell two audio tracks apart when neither is named. */
  private fun label(f: Format): String {
    val codec = (f.sampleMimeType ?: "").substringAfterLast('/').uppercase()
    val channels = when (f.channelCount) {
      1 -> " mono"
      2 -> " stereo"
      6 -> " 5.1"
      8 -> " 7.1"
      Format.NO_VALUE, 0 -> ""
      else -> " ${f.channelCount}ch"
    }
    return (codec + channels).trim().ifEmpty { "Track" }
  }

  /**
   * What the player's error card shows. The codec cases are far and away the
   * most common here, so they say what to do about it rather than quoting a
   * code at somebody holding a remote.
   */
  private fun describe(e: PlaybackException): String = when (e.errorCode) {
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
    PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
    PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
    ->
      "This device has no decoder for that release. HEVC/x265, AV1 and DTS all " +
        "depend on the hardware, and not every box has them — a 1080p x264 " +
        "release with AAC audio plays anywhere."

    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
    ->
      "The connection to the torrent engine dropped mid-stream."

    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
    ->
      "That file's container could not be read. It may still be downloading its " +
        "first pieces."

    else -> e.errorCodeName + (e.message?.let { ": $it" } ?: "")
  }

  private fun num(value: Any?, fallback: Double) = (value as? Number)?.toDouble() ?: fallback

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
