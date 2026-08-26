/**
 * The player protocol, spoken by the two backends that aren't mpv.
 *
 * Neither target can run mpv: an app gets no child process to hand a stream to
 * the way `player.rs` (X11), `player_windows.rs` (Win32) and `player_macos.rs`
 * do. What both have is a torrent engine already serving byte ranges over http
 * on 127.0.0.1, so they can open the very URL mpv would have.
 *
 *   - `exoEngine` — Android. ExoPlayer behind a `@JavascriptInterface`, on the
 *     device's own MediaCodec decoders (see `Player.kt`). The one to use where
 *     it exists: Chromium ships with Dolby and DTS disabled whatever the
 *     hardware can do, and it hides the file's own audio and subtitle tracks.
 *   - `videoEngine` — a plain browser, which is `bun run dev`. The webview's
 *     `<video>`, with the limitations that implies: no muxed tracks (Chromium's
 *     demuxer keeps them to itself) and no codec the webview was not built
 *     with. See the README's codec table.
 *
 * Rather than a player component each, both answer the same JSON commands and
 * property reads the native backends do (`player_ipc` / `player_props`), so
 * `MpvPlayer.vue` drives all three through one code path. Only the properties
 * that component asks for are implemented; anything else reads back missing,
 * which is also what mpv does for a property it can't produce.
 */
import { platform } from '@tauri-apps/plugin-os'
import { isDesktop } from './platform'

/**
 * Is mpv behind the controls? True on exactly the three targets `lib.rs`
 * compiles a real backend for — keep this in step with the `cfg_attr` there.
 * Android and a plain browser during `bun run dev` fall through to the
 * `<video>` element below.
 */
export function hasNativePlayer() {
  // Not running under Tauri at all counts as no, which `isDesktop` already says.
  return isDesktop()
}

/**
 * Does the picture paint *over* the page, or behind it?
 *
 * Over, on X11 and Win32: mpv gets a child window of the app window, which
 * nothing in the document can be drawn on top of. That is what the cutouts are
 * for — the bars are subtracted from mpv's window so the page shows through —
 * and it is also why mpv, not the webview, is the one that sees the pointer.
 *
 * Behind, on macOS: mpv is libmpv rendering into a view *under* the WKWebView
 * (`player_render_mac.rs`), because that is what the platform allows. The page
 * is then simply in front, so the controls stack in CSS and every click and
 * keystroke is an ordinary DOM event — Android's arrangement exactly, which is
 * why `MpvPlayer.vue` treats the two together.
 */
export function hasVideoOverlay() {
  try {
    const os = platform()
    return os === 'linux' || os === 'windows'
  }
  catch {
    return false
  }
}

/** The shape `player_props` reports a track in, so the menus read one list. */
export interface PlayerTrack {
  id: number
  type: string
  lang?: string
  title?: string
  external?: boolean
}

export interface PlayerEngine {
  start: (url: string) => Promise<void>
  stop: () => void
  command: (cmd: unknown[]) => unknown
  props: (names: string[]) => Record<string, unknown>
  status: () => { running: boolean, log_tail: string | null }
}

/** The bridge `MainActivity` installs on Android. See `Player.kt`. */
interface ExoBridge {
  start: (url: string) => void
  stop: () => void
  command: (json: string) => string
  props: (json: string) => string
  status: () => string
  codecs: () => string
}

function exoBridge(): ExoBridge | null {
  return (globalThis as { VenticPlayer?: ExoBridge }).VenticPlayer ?? null
}

/** Is ExoPlayer behind the controls? Android only, and only once the page is in it. */
export function hasExoPlayer() {
  return !!exoBridge()
}

let codecCache: Set<string> | null = null

/**
 * Every mime type this device can decode, or null where there is nobody to ask.
 *
 * Only Android answers: `MediaCodecList` is the platform's own record of what
 * has a decoder, which is the difference between a TV box (Dolby and HEVC in
 * hardware, nearly always) and a mid-range phone (often neither). Fixed for the
 * life of the process, so it is asked once.
 */
export function deviceCodecs(): Set<string> | null {
  if (codecCache)
    return codecCache
  const bridge = exoBridge()
  if (!bridge)
    return null
  try {
    return (codecCache = new Set(JSON.parse(bridge.codecs()) as string[]))
  }
  catch {
    return null
  }
}

/**
 * The bookkeeping both shims do for an external subtitle. The page downloads,
 * parses and draws those itself (`cueAt` / `subtitleCss` in subtitles.ts), so a
 * backend only has to remember what `track-list` should say and which one is
 * picked.
 *
 * Ids start above `EXTERNAL` because ExoPlayer numbers the tracks it found
 * inside the file from 1 and the two lists are shown as one menu — and because
 * which side owns an id is then a comparison rather than a lookup.
 */
const EXTERNAL = 1000

function externalSubs() {
  const list: PlayerTrack[] = []
  const urls: string[] = []
  return {
    list,
    /** Which external is showing, or 'no' when it is the file's own track, or none. */
    sid: 'no' as number | 'no',
    /** mpv's `sub-add`, which both adds and selects — and re-selects a repeat. */
    add(url: string, title?: string, lang?: string) {
      let at = urls.indexOf(url)
      if (at < 0) {
        at = urls.push(url) - 1
        list.push({ id: EXTERNAL + at + 1, type: 'sub', lang, title, external: true })
      }
      return (this.sid = EXTERNAL + at + 1)
    },
    /** Is this id one of ours, i.e. one the page draws rather than the backend? */
    owns(id: unknown): id is number {
      return typeof id === 'number' && id > EXTERNAL
    },
  }
}

/**
 * What the error card gets to show. `MediaError.message` is empty in every
 * engine that matters, and "error code 3" tells nobody anything — the decode
 * cases are far and away the most common here, so they say what to do about it.
 */
function mediaError(e: MediaError | null) {
  switch (e?.code) {
    case 1:
      return $t('Playback was stopped before it started.')
    case 2:
      return $t('The connection to the torrent engine dropped mid-stream.')
    case 3:
      return $t('This device\'s decoder gave up on the file. That is usually the audio: Dolby (AC-3, E-AC-3, TrueHD) and DTS are not licensed into the system webview, so a release carrying one plays as a picture with no sound, or not at all. An x264 release with AAC audio will play.')
    case 4:
      return $t('Nothing on this device can open that file. HEVC/x265 and AV1 depend on the hardware decoder, and older boxes have neither — try a 1080p x264 release.')
    default:
      return $t('Playback stopped and the webview gave no reason.')
  }
}

/**
 * Drive `video` as if it were mpv. One engine per mounted player; the element
 * owns the listeners, so both die together.
 */
export function videoEngine(video: HTMLVideoElement): PlayerEngine {
  const ext = externalSubs()
  let running = false
  let failure = ''

  // `running` is what the poll's liveness check reads: false after the file
  // plays out is end-of-playback, false with a message is a failure.
  video.addEventListener('ended', () => (running = false))
  video.addEventListener('error', () => {
    // Tearing down clears the source, which counts as an error in some engines.
    if (!running)
      return
    running = false
    failure = mediaError(video.error)
  })

  /**
   * How far the stream is continuously buffered from where we are. Ranges
   * either side of a seek don't count — the seek bar is showing what will play
   * next, not what happens to be in memory.
   */
  function bufferedTo() {
    const b = video.buffered
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= video.currentTime + 0.5 && b.end(i) >= video.currentTime)
        return b.end(i)
    }
    return 0
  }

  const READ: Record<string, () => unknown> = {
    'pause': () => video.paused,
    // Nothing to play with and not paused on purpose: that is a stall.
    'paused-for-cache': () => !video.paused && video.readyState < 3,
    'duration': () => Number.isFinite(video.duration) ? video.duration : 0,
    'time-pos': () => video.currentTime,
    'demuxer-cache-time': () => bufferedTo(),
    'volume': () => Math.round(video.volume * 100),
    'mute': () => video.muted,
    'speed': () => video.playbackRate,
    'track-list': () => ext.list,
    'sid': () => ext.sid,
    // Chromium exposes no audio track list, so there is only ever the one.
    'aid': () => 'no',
    // An unsupported *audio* codec raises no error at all: the video decodes,
    // the Dolby/DTS track doesn't, and the file plays as a silent picture. Bytes
    // still at zero once it is really playing is the only tell there is. Engines
    // without the counter (Firefox, node in check-player) say no rather than
    // warn wrongly.
    'silent': () => 'webkitAudioDecodedByteCount' in video
      && !(video as unknown as { webkitAudioDecodedByteCount: number }).webkitAudioDecodedByteCount,
  }

  function setProp(name: string, value: unknown) {
    switch (name) {
      case 'pause':
        // A rejected play() is an autoplay block, not a failure: the element
        // stays paused and the button is right there.
        value ? video.pause() : video.play().catch(() => {})
        break
      case 'time-pos':
        video.currentTime = Number(value)
        break
      case 'volume':
        video.volume = Math.min(1, Math.max(0, Number(value) / 100))
        break
      case 'mute':
        video.muted = !!value
        break
      case 'speed':
        video.playbackRate = Number(value)
        break
      case 'sid':
        ext.sid = ext.owns(value) ? value : 'no'
        break
      // sub-delay and the sub-* look are applied where the cues are drawn, and
      // `aid` has nothing to select between. Levelling and the dialogue boost
      // (`audio-normalize`, `dialogue-boost`) would want a WebAudio graph in
      // front of the element; this path is `bun run dev` in a browser, so they
      // are ignored rather than built twice.
    }
  }

  return {
    async start(url: string) {
      failure = ''
      running = true
      video.src = url
      video.load()
      await video.play().catch(() => {})
    },

    stop() {
      running = false
      video.pause()
      // Let go of the source properly: left attached, the element keeps a
      // reader open on the engine's stream endpoint for the whole session.
      video.removeAttribute('src')
      video.load()
    },

    command(cmd: unknown[]) {
      const [name, ...rest] = cmd as [string, ...unknown[]]
      if (name === 'set_property')
        setProp(String(rest[0]), rest[1])
      else if (name === 'sub-add')
        return ext.add(String(rest[0]), rest[2] as string, rest[3] as string)
      // `keybind` has no native window to bind on, and `show-text` is drawn by
      // the page: both are no-ops rather than errors.
      return null
    },

    props(names: string[]) {
      const out: Record<string, unknown> = {}
      for (const name of names) {
        const read = READ[name]
        if (read)
          out[name] = read()
      }
      return out
    },

    status: () => ({ running, log_tail: failure || null }),
  }
}

/**
 * Drive ExoPlayer as if it were mpv, or null where there is no bridge to drive.
 *
 * Everything real happens in `Player.kt`; this is the translation and the one
 * thing Kotlin is deliberately not told about — external subtitles, which the
 * page owns end to end. Their ids are merged into the file's own `track-list`
 * so the menu shows one list, and picking one turns ExoPlayer's text renderer
 * off so the two don't draw over each other.
 */
export function exoEngine(): PlayerEngine | null {
  const bridge = exoBridge()
  if (!bridge)
    return null

  const ext = externalSubs()
  const send = (cmd: unknown[]) => bridge.command(JSON.stringify(cmd))

  return {
    async start(url: string) {
      ext.sid = 'no'
      bridge.start(url)
    },

    stop: () => bridge.stop(),

    command(cmd: unknown[]) {
      const [name, ...rest] = cmd as [string, ...unknown[]]

      if (name === 'sub-add') {
        const id = ext.add(String(rest[0]), rest[2] as string, rest[3] as string)
        send(['set_property', 'sid', 'no'])
        return id
      }

      if (name === 'set_property' && rest[0] === 'sid') {
        ext.sid = ext.owns(rest[1]) ? rest[1] : 'no'
        send(['set_property', 'sid', ext.sid === 'no' ? rest[1] : 'no'])
        return null
      }

      if (name === 'set_property')
        send(cmd)
      // As in videoEngine: `keybind` has no window and `show-text` is the page's.
      return null
    },

    props(names: string[]) {
      let out: Record<string, unknown> = {}
      try {
        out = JSON.parse(bridge.props(JSON.stringify(names)))
      }
      catch {
        return {}
      }
      if (Array.isArray(out['track-list']))
        out['track-list'] = [...out['track-list'], ...ext.list]
      // ExoPlayer reports 'no' while the page is drawing one of ours, which the
      // menu would read as subtitles being off.
      if ('sid' in out && ext.sid !== 'no')
        out.sid = ext.sid
      return out
    },

    status() {
      try {
        return JSON.parse(bridge.status())
      }
      catch {
        return { running: false, log_tail: 'The Android player stopped answering.' }
      }
    },
  }
}
