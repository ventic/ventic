import assert from 'node:assert'
import { deviceCodecs, exoEngine, hasNativePlayer, hasVideoOverlay, videoEngine } from '../app/utils/htmlvideo'
import { nearestFrame, walkOrder } from '../app/utils/thumbs'
// Self-check for the <video> player backend: `bun scripts/check-player.ts`.
//
// The shim answers mpv's command/property protocol so one component drives
// either backend (app/utils/htmlvideo.ts). What's worth pinning down is the
// translation itself — a volume that's out by 100x or a `sid` that doesn't
// stick shows up as a silent film or missing subtitles, neither of which says
// which side got it wrong.
import './i18n-stub'

/** Just the surface `videoEngine` touches — a DOM would be a dependency for six properties. */
function fakeVideo() {
  const listeners: Record<string, (() => void)[]> = {}
  return {
    paused: true,
    currentTime: 0,
    duration: Number.NaN,
    volume: 1,
    muted: false,
    playbackRate: 1,
    readyState: 4,
    error: null as { code: number } | null,
    src: '',
    buffered: { length: 1, start: () => 0, end: () => 90 },
    play() {
      this.paused = false
      return Promise.resolve()
    },
    pause() {
      this.paused = true
    },
    load() {},
    removeAttribute(name: string) {
      if (name === 'src')
        this.src = ''
    },
    addEventListener(name: string, fn: () => void) {
      (listeners[name] ??= []).push(fn)
    },
    /** Stand-in for the element firing one of its own events. */
    emit(name: string) {
      listeners[name]?.forEach(fn => fn())
    },
  }
}

const video = fakeVideo()

const player = videoEngine(video as any)

// Out here there is no Tauri at all, which is the same answer a browser gives
// and the reason `bun run dev` gets a working player.
assert.equal(hasNativePlayer(), false)
assert.equal(exoEngine(), null, 'and no Android bridge, so no ExoPlayer either')
// Nor a surface in front of the page: both platform questions have to answer no
// off Tauri, or the browser build punches holes for a window that isn't there.
assert.equal(hasVideoOverlay(), false)

// Nothing has been started, so nothing is running and nothing has failed.
assert.deepEqual(player.status(), { running: false, log_tail: null })

await player.start('http://127.0.0.1:3030/torrents/1/stream/0')
assert.equal(video.src, 'http://127.0.0.1:3030/torrents/1/stream/0')
assert.equal(video.paused, false, 'a started file plays')
assert.equal(player.status().running, true)

// --- Properties, as the poll reads them ---------------------------------------
video.currentTime = 42
video.duration = 5400
const p = player.props(['pause', 'time-pos', 'duration', 'volume', 'demuxer-cache-time', 'paused-for-cache'])
assert.equal(p.pause, false)
assert.equal(p['time-pos'], 42)
assert.equal(p.duration, 5400)
assert.equal(p.volume, 100, 'mpv counts volume to 100, the element to 1')
assert.equal(p['demuxer-cache-time'], 90, 'absolute, like mpv reports it — not a length')
assert.equal(p['paused-for-cache'], false)

// A duration the element hasn't worked out yet must read 0, not NaN: the seek
// bar divides by it.
video.duration = Number.NaN
assert.equal(player.props(['duration']).duration, 0)
video.duration = 5400

// Anything the shim can't produce is simply absent, exactly as mpv leaves a
// property it has no answer for.
assert.deepEqual(player.props(['mouse-pos']), {})

// A Dolby/DTS track the device can't decode plays silently and raises nothing,
// so zero decoded bytes is the warning. No counter at all must stay quiet — the
// alternative is telling every Firefox user their sound is broken.
assert.equal(player.props(['silent']).silent, false, 'no counter, no claim')
;(video as any).webkitAudioDecodedByteCount = 0
assert.equal(player.props(['silent']).silent, true)
;(video as any).webkitAudioDecodedByteCount = 4096
assert.equal(player.props(['silent']).silent, false)
delete (video as any).webkitAudioDecodedByteCount

// Buffered ranges that don't reach the playhead are somewhere else in the file.
video.currentTime = 600
assert.equal(player.props(['demuxer-cache-time'])['demuxer-cache-time'], 0)
video.currentTime = 42

// Starved of data mid-play is a stall; the same readyState while paused is not.
video.readyState = 1
assert.equal(player.props(['paused-for-cache'])['paused-for-cache'], true)
video.readyState = 4

// --- Commands, as the controls send them ---------------------------------------
player.command(['set_property', 'pause', true])
assert.equal(video.paused, true)
player.command(['set_property', 'time-pos', 120])
assert.equal(video.currentTime, 120)
player.command(['set_property', 'volume', 40])
assert.equal(video.volume, 0.4)
player.command(['set_property', 'volume', 250])
assert.equal(video.volume, 1, 'clamped, or the element throws and the volume sticks')
player.command(['set_property', 'speed', 1.5])
assert.equal(video.playbackRate, 1.5)
player.command(['set_property', 'mute', true])
assert.equal(video.muted, true)

// Unknown commands are ignored rather than thrown: `keybind` has no window to
// bind on and `show-text` is drawn by the page.
assert.doesNotThrow(() => player.command(['keybind', 'MBTN_LEFT', 'cycle pause']))
assert.doesNotThrow(() => player.command(['show-text', 'hello', 1200, 0]))

// --- Subtitles ------------------------------------------------------------------
// `sub-add` adds *and* selects, which is what mpv does and what the menu counts
// on: picking a language has to switch to it in one step.
// Ids start above 1000 so they can never collide with a track ExoPlayer found
// inside the file, which the other backend merges into the same menu.
const first = player.command(['sub-add', 'https://subs/a.srt', 'cached', 'English', 'eng'])
assert.equal(first, 1001)
assert.equal(player.props(['sid']).sid, 1001)
player.command(['sub-add', 'https://subs/b.srt', 'cached', 'German', 'ger'])
assert.equal(player.props(['sid']).sid, 1002)

// The same file again re-selects it instead of stacking a duplicate track —
// which is what `cached` means, and what re-picking a language does.
assert.equal(player.command(['sub-add', 'https://subs/a.srt', 'cached', 'English', 'eng']), 1001)
const tracks = player.props(['track-list'])['track-list'] as { id: number, external?: boolean }[]
assert.equal(tracks.length, 2)
assert.ok(tracks.every(t => t.external), 'nothing here is muxed into the file')

player.command(['set_property', 'sid', 'no'])
assert.equal(player.props(['sid']).sid, 'no', 'subtitles off stays off')

// --- Ending, and failing ---------------------------------------------------------
video.emit('ended')
assert.deepEqual(player.status(), { running: false, log_tail: null }, 'playing out is not a failure')

await player.start('http://127.0.0.1:3030/torrents/1/stream/0')
video.error = { code: 4 }
video.emit('error')
assert.equal(player.status().running, false)
assert.match(player.status().log_tail ?? '', /x264/, 'the decode errors say what to do about it')

// Tearing down clears the source, and an engine that reports that as an error
// must not overwrite the real reason playback stopped.
player.stop()
assert.equal(video.src, '', 'the reader on the engine is let go of')
video.emit('error')
assert.equal(player.status().running, false)

// --- ExoPlayer, on Android --------------------------------------------------------
// The same protocol over a @JavascriptInterface instead of a DOM element, so
// most of it is Kotlin's problem (Player.kt) and untestable from here. What is
// worth pinning down is the half Kotlin is deliberately *not* told about:
// external subtitles belong to the page, so their ids have to survive the round
// trip and can never be confused with a track found inside the file.
const sent: unknown[][] = []
const bridge = {
  state: {
    'sid': 'no' as unknown,
    'aid': 1 as unknown,
    'track-list': [
      { id: 1, type: 'audio', title: 'EAC3 5.1' },
      { id: 2, type: 'sub', lang: 'eng' },
    ] as unknown,
  } as Record<string, unknown>,
  start() {},
  stop() {},
  command(json: string) {
    const cmd = JSON.parse(json) as unknown[]
    sent.push(cmd)
    if (cmd[0] === 'set_property')
      this.state[String(cmd[1])] = cmd[2]
    return 'null'
  },
  props(json: string) {
    const out: Record<string, unknown> = {}
    for (const name of JSON.parse(json) as string[]) {
      if (name in this.state)
        out[name] = this.state[name]
    }
    return JSON.stringify(out)
  },
  status: () => JSON.stringify({ running: true, log_tail: null }),
  codecs: () => JSON.stringify(['audio/eac3', 'video/hevc']),
}
;(globalThis as any).VenticPlayer = bridge

const exo = exoEngine()!
assert.ok(exo, 'the bridge being there is what decides, not the platform')

// A track inside the file is ExoPlayer's to select, and goes through untouched.
exo.command(['set_property', 'aid', 1])
assert.deepEqual(sent.at(-1), ['set_property', 'aid', 1])

// A downloaded one is not: the page draws it, so ExoPlayer's own text renderer
// has to go off or the two would draw over each other.
assert.equal(exo.command(['sub-add', 'https://subs/a.srt', 'cached', 'English', 'eng']), 1001)
assert.deepEqual(sent.at(-1), ['set_property', 'sid', 'no'])
assert.equal(exo.props(['sid']).sid, 1001, 'which ExoPlayer would otherwise report as off')

const merged = exo.props(['track-list'])['track-list'] as { id: number }[]
assert.deepEqual(merged.map(t => t.id), [1, 2, 1001], 'one menu, and no id used twice')

// Picking one of the file's own hands selection back to ExoPlayer.
exo.command(['set_property', 'sid', 2])
assert.deepEqual(sent.at(-1), ['set_property', 'sid', 2])
assert.equal(exo.props(['sid']).sid, 2)

// What `isAwkward` asks before demoting a release for a codec this device may
// well have — the whole reason a TV box stops being handed the x264 copy.
assert.ok(deviceCodecs()?.has('audio/eac3'), 'a box with Dolby says so')

// --- Seek previews ----------------------------------------------------------------
// The order frames get decoded in, and the stand-in shown while one still is.
// Both are arithmetic the player can't tell you it got wrong: it just quietly
// stops previewing.
const BUCKET = 5
const COARSE = BUCKET * 128

for (const duration of [7200, 1320, 300, 47, 5, 0]) {
  const order = [...walkOrder(duration, BUCKET, COARSE)]
  const seen = new Set(order)
  const want = Math.ceil(duration / BUCKET)

  assert.equal(seen.size, want, `${duration}s: every bucket reached`)
  for (let at = 0; at < duration; at += BUCKET)
    assert.ok(seen.has(at), `${duration}s: ${at} reached`)

  // The hover rounds down to a multiple of BUCKET. Land anywhere else and the
  // walk fills a cache the hover never reads.
  for (const at of seen)
    assert.equal(at, Math.floor(at / BUCKET) * BUCKET, `${duration}s: ${at} is on the grid`)

  // Re-walking earlier passes is what buys the subdivision; 8 passes over a
  // film is the ceiling, and it must not creep past that.
  assert.ok(order.length <= seen.size * 2 + 8, `${duration}s: ${order.length} steps for ${seen.size} frames`)
}

// Coarse first is the whole point: the opening pass has to span the film, not
// camp at the start, or the far half previews nothing until the walk gets there.
const twoHours = [...walkOrder(7200, BUCKET, COARSE)]
assert.ok(twoHours.slice(0, 12).some(at => at > 7200 * 0.8), 'the first pass reaches the end')
assert.equal(twoHours[1], COARSE, 'and it steps by the coarse stride, not the fine one')

const frames = new Map([[0, 'a.jpg'], [600, 'b.jpg'], [900, ''], [1200, 'c.jpg']])
assert.equal(nearestFrame(frames, 600, 60), 'b.jpg', 'its own frame wins')
assert.equal(nearestFrame(frames, 630, 60), 'b.jpg', 'a near one stands in')
assert.equal(nearestFrame(frames, 780, 60), null, 'nothing near enough to be worth showing')
// A position ffmpeg got nothing at is cached as '' — it is not a frame, and must
// never be handed back as one.
assert.equal(nearestFrame(frames, 900, 60), null, 'an empty is not a stand-in')
assert.equal(nearestFrame(frames, 890, 60), null)
assert.equal(nearestFrame(new Map(), 0, 60), null, 'an empty cache answers nothing')

// The bar's tooltips and the cast dialog are the overlays this repo doesn't own
// the markup of: Vuetify teleports them out of the player, so MpvPlayer's cutout
// selector has to name Vuetify's own classes to get them punched out of mpv's
// window. A rename upstream would break that silently, and only on X11 and
// Win32 — the two targets a browser check can't see. It is not a small failure:
// an uncut dialog is one that dims the screen and then shows nothing.
const overlay = await Bun.file('node_modules/vuetify/lib/components/VOverlay/VOverlay.js').text()
assert.match(overlay, /'v-overlay--active': isActive/, 'vuetify still marks an open overlay the way the tracker looks for it')
const tooltipCss = await Bun.file('node_modules/vuetify/lib/components/VTooltip/VTooltip.sass').text()
assert.match(tooltipCss, /\.v-tooltip\n\s+> \.v-overlay__content/, 'and still nests the content one level inside it')
const mpv = await Bun.file('app/components/MpvPlayer.vue').text()
assert.match(mpv, /const CUT = '\[data-cut\], \.v-overlay--active > \.v-overlay__content'/, 'and the tracker still looks for both')
assert.ok(!mpv.includes('rootEl.value?.querySelectorAll'), 'scoped to the player, a teleported overlay is never found')

// The other half of the same seam: Escape closes that dialog, and the player's
// page must not take the press as "leave the film" while one is up.
const watch = await Bun.file('app/pages/watch.vue').text()
assert.match(watch, /Escape' && !document\.querySelector\('\.v-overlay--active/, 'Escape closes an open dialog before it leaves playback')

// Keeping the screen on is three files agreeing on one string, and nothing
// compiles the agreement: the player invokes a command by name, lib.rs decides
// which names exist, and awake.rs is what runs. Rename any one of them and the
// call rejects into a `.catch(() => {})` — a film that plays perfectly and a
// screen that blanks twenty minutes in, on the two platforms mpv can't ask for
// itself (X11 embeds it in our window, macOS gives it no window at all).
const awake = await Bun.file('src-tauri/src/awake.rs').text()
const lib = await Bun.file('src-tauri/src/lib.rs').text()
assert.match(mpv, /invoke\('keep_awake', \{ on \}\)/, 'the player asks for it while playing')
assert.match(mpv, /invoke\('keep_awake', \{ on: false \}\)/, 'and gives it back on the way out')
assert.match(awake, /pub fn keep_awake\(on: bool\)/, 'awake.rs answers to that name')
assert.match(lib, /awake::keep_awake/, 'and lib.rs hands it to the frontend')
// Both halves of the pairing come off one expression, so a film that is up but
// paused releases it — mpv's own behaviour, and the difference between a screen
// timeout that works again after the credits and one that never does.
assert.match(mpv, /watch\(\(\) => started\.value && !paused\.value/, 'and pausing lets the screen go')

// eslint-disable-next-line no-console
console.log('player: ok')
