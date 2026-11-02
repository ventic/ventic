// Self-check for the subtitle grouping/naming, the file labelling and the
// auto-sync offset search: `bun scripts/check-subtitles.ts`.
// The fixtures are trimmed real responses; pass --live to also hit the addons.

import assert from 'node:assert'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import {
  bestSync,
  byLanguage,
  cueAt,
  decodeSubtitle,
  fileLabel,
  fileNote,
  findImdbId,
  findSubtitles,
  fitsRuntime,
  isCaptions,
  langFlag,
  langName,
  mpvSource,
  parseCues,
  probe,
  probeLanguage,
  quota,
  releaseSubtitle,
  stripCaptions,
  subdlCode,
  subRuntime,
  subsourceName,
  SUBTITLE_DEFAULTS,
  SUBTITLE_FONTS,
  subtitleCss,
  subtitleFontCss,
  subtitleLift,
  subtitleProps,
  synced,
} from '../app/utils/subtitles'
import './i18n-stub'

const subtitles = [
  { id: '1', url: 'https://subs5.strem.io/a', lang: 'eng' },
  { id: '2', url: 'https://subs5.strem.io/b', lang: 'eng' },
  { id: '3', url: 'https://subs5.strem.io/c', lang: 'slv' },
  { id: '4', url: 'https://subs5.strem.io/d', lang: 'pob' },
  { id: '5', url: 'https://subs5.strem.io/e', lang: 'ger' },
  { id: '6', url: 'https://subs5.strem.io/f', lang: 'deu' }, // same language, other code
]

// Bibliographic vs terminological codes have to collapse, or an mkv's "ger"
// track and the addon's "deu" file look like two different languages.
assert.equal(langName('ger'), langName('deu'))
assert.equal(langName('eng'), 'English')
assert.equal(langName('pob'), 'Portuguese (Brazil)') // Intl doesn't know this one
assert.equal(langName('zzz'), 'zzz') // not a language tag: shown as-is, not dropped

const langs = byLanguage(subtitles)
assert.deepEqual(langs.map(l => l.name), ['English', 'German', 'Portuguese (Brazil)', 'Slovenian'])
assert.equal(langs[0]!.files.length, 2)
assert.equal(langs[0]!.files[0]!.url, 'https://subs5.strem.io/a', 'addon order is kept inside a language')
assert.equal(langs[1]!.files.length, 2, 'ger + deu are one language')
assert.deepEqual(byLanguage([]), [])

// --- subtitles shipped inside the release ----------------------------------
// The video's own name is noise repeated on every one of them; what's left is
// the label, and a language tag in it is spelled out.
const video = 'Example.Show.S01E07.1080p.WEB.DL.x264.mkv'
const named = (path: string) => releaseSubtitle(path, video, 'http://127.0.0.1:3030/torrents/1/stream/2')
assert.equal(named('Example.Show.S01E07.1080p.WEB.DL.x264.eng.srt').name, 'English')
assert.equal(named('Example.Show.S01E07.1080p.WEB.DL.x264.eng.srt').code, 'eng')
assert.equal(named('Subs/Example.Show.S01E07/2_English.srt').name, 'English', 'the muxer index is not a name')
assert.equal(named('Subs/Example.Show.S01E07/2_English.srt').code, '', 'a spelled-out name is no code')
// "SDH" is a real ISO 639-3 code (Southern Kurdish) and never means it here.
assert.equal(named('Subs/4_English.SDH.srt').name, 'English SDH')
assert.equal(named('Subs/4_English.SDH.srt').code, '')
assert.equal(named('Example.Show.S01E07.1080p.WEB.DL.x264.srt').name, 'Subtitles', 'nothing left to say')
assert.equal(named('Example.Show.S01E07.1080p.WEB.DL.x264.srt').code, '', 'no code invented')
assert.equal(named('Subs/es-419.srt').name, 'Spanish', 'a tag is spelled out')
assert.equal(named('whatever.srt').name, 'whatever', 'shown as it is rather than hidden')
assert.equal(named('Subs/2_English.srt').files[0]!.url, 'http://127.0.0.1:3030/torrents/1/stream/2')
// The label is the trimmed words; the file keeps its whole name for the row
// underneath it, which is the one place the user can see what it really is.
assert.equal(named('Subs/Example.Show.S01E07/2_English.srt').files[0]!.name, '2_English.srt')

// --- telling one file of a language from another ---------------------------
// The listing gives a url, a language and nothing else, so everything the menu
// says about a file is read back out of the file itself.
function file(cues: { start: number, end: number, text: string }[], extra = {}) {
  return { id: '1', url: 'https://x/1', lang: 'eng', cues, captions: false, ...extra }
}
const twoHours = [{ start: 10, end: 12, text: 'Hi' }, { start: 7300, end: 7320, text: 'Bye' }]

assert.equal(subRuntime(file(twoHours)), 7320, 'the last line is where the file ends')
assert.equal(subRuntime(file([])), 0)

// A file for the right film stops a few minutes before the credits do.
assert.equal(fitsRuntime(file(twoHours), 7500), true)
// One for a 45-minute episode, dropped onto a two-hour film: not this video.
assert.equal(fitsRuntime(file([{ start: 10, end: 2670, text: 'Bye' }]), 7500), false)
// An extended cut runs long enough to be a different film as far as this goes.
assert.equal(fitsRuntime(file([{ start: 10, end: 9600, text: 'Bye' }]), 7500), false)
// 25fps against 23.976 is 4.3% out and `sub-speed` fixes it — keep those.
assert.equal(fitsRuntime(file([{ start: 10, end: 7500 * 1.043, text: 'Bye' }]), 7500), true)
assert.equal(fitsRuntime(file([{ start: 10, end: 7500 / 1.043, text: 'Bye' }]), 7500), true)
// Nothing to judge by is never a reason to condemn a file.
assert.equal(fitsRuntime(file(twoHours), 0), true, 'no duration yet')
assert.equal(fitsRuntime(file([]), 7500), true, 'unreadable is unreadable, not wrong')

assert.equal(fileLabel(file(twoHours)), 'Dialogue only')
assert.equal(fileLabel(file(twoHours, { captions: true })), 'Captions (SDH)')
assert.equal(fileLabel(file([])), 'Unreadable')
// A provider that named the file wins: a release name says which cut it is for,
// which is the one thing the derived label can never say.
assert.equal(fileLabel(file(twoHours, { name: 'Film.2019.1080p.BluRay-RARBG.srt' })), 'Film.2019.1080p.BluRay-RARBG.srt')
assert.equal(fileNote(file(twoHours)), '2h 2m · 2 lines')
assert.equal(fileNote(file([])), 'Unreadable')
assert.equal(
  fileNote(file(twoHours, { name: 'x.srt', captions: true })),
  'SDH · 2h 2m · 2 lines',
  'with a name shown above, the row still has to say it is the captioned cut',
)

// --- cue parsing -----------------------------------------------------------
const srt = `1
00:00:12,500 --> 00:00:14,000
Hello there.

2
00:01:02,000 --> 00:01:04,250
- General Kenobi.
- [lightsaber hums]
`
const cues = parseCues(srt)
assert.equal(cues.length, 2)
assert.equal(cues[0]!.start, 12.5)
assert.equal(cues[0]!.end, 14)
assert.equal(cues[1]!.start, 62)
assert.equal(cues[1]!.text, '- General Kenobi.\n- [lightsaber hums]')

// WebVTT is the same file with dots and a header.
const vtt = parseCues('WEBVTT\n\n00:00:12.500 --> 00:00:14.000 line:0\nHello there.\n')
assert.equal(vtt.length, 1)
assert.equal(vtt[0]!.start, 12.5)
assert.deepEqual(parseCues('[Script Info]\nDialogue: 0,0:00:01.00'), [], 'ASS parses to nothing, not to junk')

// Markup is for whoever renders the line. Everywhere but mpv the page draws the
// text as plain DOM, so anything left in here is read out as characters — which
// is what put a literal "<i>" on screen on Android and on the TV.
const marked = parseCues(`1
00:00:01,000 --> 00:00:02,000
{\\an8}<i>Hello</i> <b>there</b>
<font color="#ff0000">General Kenobi.</font>

2
00:00:03,000 --> 00:00:04,000
{\\an8}
<i>[door creaks]</i>
`)
assert.equal(marked[0]!.text, 'Hello there\nGeneral Kenobi.')
assert.equal(marked[1]!.text, '[door creaks]', 'a line that was only markup leaves no blank one behind')
// And the caption detector reads the bracket that italics used to hide.
assert.equal(isCaptions(Array.from({ length: 200 }, (_, i) =>
  ({ start: i, end: i + 1, text: i % 8 ? 'Just talking.' : marked[1]!.text }))), true)

// --- SDH detection ---------------------------------------------------------
const dialogue = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 1, text: 'Just talking.' }))
assert.equal(isCaptions(dialogue), false)
assert.equal(isCaptions(dialogue.slice(0, 3)), false, 'a three-line file is never enough to judge')
const sdh = dialogue.map((c, i) => i % 8 ? c : { ...c, text: '(electricity buzzing)' })
assert.equal(isCaptions(sdh), true)
assert.equal(isCaptions(dialogue.map((c, i) => i % 8 ? c : { ...c, text: 'MAN:\nGet down!' })), true)
assert.equal(
  isCaptions(dialogue.map((c, i) => i === 4 ? { ...c, text: '[sighs]' } : c)),
  false,
  'one stray bracket in a whole film is not a captions track',
)

// --- hiding the hearing-impaired additions ---------------------------------
// The same job mpv's `sub-filter-sdh` does, for the backends that draw cues
// themselves. Verified against mpv 0.41 rather than guessed at.
assert.equal(stripCaptions('[thunder rumbling]'), '', 'a described sound is the whole line')
assert.equal(stripCaptions('MAN: Get down!'), 'Get down!', 'the speaker label comes off')
assert.equal(stripCaptions('Hello (door creaks) there'), 'Hello there', 'and an enclosure inside a line')
assert.equal(stripCaptions('- [door creaks]\n- Run.'), 'Run.', 'the orphaned dialogue dash goes too')
assert.equal(stripCaptions('Real dialogue here.'), 'Real dialogue here.')
// Prose is full of colons and parentheses; only the SDH shapes may be touched.
assert.equal(stripCaptions('I told him: go home.'), 'I told him: go home.', 'a sentence is not a speaker label')
assert.equal(stripCaptions('Wait — what?'), 'Wait — what?')

// --- the fit ---------------------------------------------------------------
// Five minutes of someone talking in bursts, quiet in between, as the envelope
// the backend measures: loud in dB while a burst runs, near-silent otherwise.
// Irregular on purpose — evenly spaced speech fits equally well at every spacing.
const BIN = 0.2
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const speech: [number, number][] = []
for (let at = 4; at < 290;) {
  const len = 1 + rnd() * 3
  speech.push([at, at + len])
  at += len + 0.8 + rnd() * 6
}

/** The bursts as an audio envelope over `span` seconds, `rate`-stretched. */
function envelope(span: number, rate = 1) {
  const env = new Float32Array(Math.round(span / BIN)).fill(-60)
  for (const [s, e] of speech) {
    for (let i = Math.round(s * rate / BIN); i < Math.round(e * rate / BIN) && i < env.length; i++)
      env[i] = -20
  }
  return env
}

function shift(by: number, rate = 1) {
  return speech.map(([s, e]) => ({ start: s * rate + by, end: e * rate + by, text: '…' }))
}

/**
 * The same bursts under a real mix: levels that wander a reel at a time, a music
 * bed under the middle third that is louder than anyone talking, and effects
 * nobody subtitled. This is the case the fit used to get wrong — correlating
 * against the loudness itself pulls the cues towards the music, because the
 * music is where the numbers are biggest.
 */
function scored(span: number, rate = 1) {
  const env = new Float32Array(Math.round(span / BIN))
  for (let i = 0; i < env.length; i++) {
    const t = i * BIN
    env[i] = t > span / 3 && t < 2 * span / 3 ? -26 : -58 + 6 * Math.sin(t / 240)
    // A door, a gunshot, a car: loud, regular, and in no subtitle file.
    if (t % 47 < 1.5)
      env[i]! += 22
  }
  for (const [s, e] of speech) {
    for (let i = Math.round(s * rate / BIN); i < Math.round(e * rate / BIN) && i < env.length; i++)
      env[i]! += 12
  }
  return env
}

const audio = envelope(1200)

const fix = bestSync(shift(-3), audio, 0)
assert.ok(Math.abs(fix.offset - 3) < 0.3, `early subtitles get pushed back, got ${fix.offset}`)
assert.ok(synced(fix), 'and the fit is trusted')
assert.equal(fix.speed, 1, 'a plain shift needs no rate change')
assert.ok(Math.abs(bestSync(shift(7.5), audio, 0).offset + 7.5) < 0.3, 'late subtitles get pulled forward')
assert.ok(Math.abs(bestSync(shift(-45), audio, 0).offset - 45) < 0.3, 'and a whole scene of drift still lands')

// The peak is interpolated between bins, so a file that needs nothing lands on
// a hair either side of zero rather than exactly on it.
const fine = bestSync(shift(0), audio, 0)
assert.ok(Math.abs(fine.offset) < 0.05, `an in-sync file needs no shift, got ${fine.offset}`)
assert.equal(fine.speed, 1)
assert.ok(synced(fine), 'an in-sync file is recognised as one rather than nudged')

// A file cut for 25 fps PAL against a 23.976 transfer drifts a minute an hour;
// no single delay fixes that, which is what `sub-speed` is for.
const PAL = 25 / 23.976
const drift = bestSync(shift(0, 1 / PAL), audio, 0)
assert.ok(Math.abs(drift.speed - PAL) < 1e-6, `the rate error is found, got ${drift.speed}`)
assert.ok(Math.abs(drift.offset) < 0.5, `and needs no shift on top, got ${drift.offset}`)
assert.ok(synced(drift))

// A film mix rather than a test tone: the fit has to follow the voices past a
// music bed that is louder than they are and past effects that aren't dialogue.
const mixed = bestSync(shift(-3), scored(1200), 0)
assert.ok(Math.abs(mixed.offset - 3) < 0.3, `the music doesn't drag the fit, got ${mixed.offset}`)
assert.ok(synced(mixed), `and it is still trusted, got score ${mixed.score.toFixed(2)} at ${mixed.confidence.toFixed(1)}σ`)
assert.equal(mixed.speed, 1)
const mixedDrift = bestSync(shift(0, 1 / PAL), scored(1200), 0)
assert.ok(Math.abs(mixedDrift.speed - PAL) < 1e-6, `and the rate error too, got ${mixedDrift.speed}`)

/**
 * A 1968 optical mono print: hiss under everything and about six decibels
 * between it and a shout. Any fixed idea of "loud enough to be a voice" reads
 * the whole reel as either silent or spoken; the fit has to normalise to the
 * range the film actually has.
 */
function optical(span: number, talking = true) {
  const env = new Float32Array(Math.round(span / BIN))
  for (let i = 0; i < env.length; i++)
    env[i] = -38 + Math.sin(i * BIN / 130) * 2 + Math.sin(i * 12.9898) * 1.5
  if (talking) {
    for (const [s, e] of speech) {
      for (let i = Math.round(s / BIN); i < Math.round(e / BIN) && i < env.length; i++)
        env[i]! += 6
    }
  }
  return env
}

const faint = bestSync(shift(-3), optical(1200), 0)
assert.ok(Math.abs(faint.offset - 3) < 0.3, `six decibels of range is enough to fit on, got ${faint.offset}`)
assert.ok(synced(faint), `and to be sure of, got ${faint.score.toFixed(2)} at ${faint.confidence.toFixed(1)}σ`)
// Hiss and nothing else. Normalising to the film's own range must not turn the
// wobble into a full-scale mask and then fit the cues to it.
assert.ok(!synced(bestSync(shift(-3), optical(1200, false), 0)), 'a reel with nothing said in it is refused')

// The window the caller gets to work with is what has played, and a short one
// has enough freedom to fit anywhere. Refusing beats a confident wrong answer.
assert.equal(bestSync(shift(-3), envelope(200), 0).score, 0, 'three minutes is not enough to be sure')
assert.equal(bestSync([], audio, 0).score, 0, 'no cues, no verdict')
assert.equal(bestSync(shift(-3), envelope(10), 0).score, 0, 'and neither is ten seconds')
// Five minutes is a verdict on the shift, but not on the rate: a tenth of a
// percent over that window is under the slop, so it would be guessed off noise.
const short = bestSync(shift(-3, 1 / PAL), envelope(400, 1 / PAL), 0)
assert.ok(Math.abs(short.offset - 3) < 0.4, `a short window still finds the shift, got ${short.offset}`)
assert.equal(short.speed, 1, 'and leaves the rate alone rather than guessing it')
// Nothing but room tone: every shift correlates exactly as badly as every other.
assert.ok(!synced(bestSync(shift(-3), new Float32Array(6000).fill(-60), 0)), 'silence gives no verdict')
// The same generator, a different film. Dialogue is dialogue, so some shift
// always correlates better than the others — the fit has to notice that the
// winner didn't win by much and say so instead of shifting by a minute.
const other: [number, number][] = []
for (let at = 6; at < 290;) {
  const len = 1 + rnd() * 3
  other.push([at, at + len])
  at += len + 0.8 + rnd() * 6
}
const foreign = bestSync(other.map(([s, e]) => ({ start: s, end: e, text: '…' })), audio, 0)
assert.ok(
  !synced(foreign),
  `a file for another film is refused, got ${foreign.score.toFixed(2)} at ${foreign.confidence.toFixed(1)}σ`,
)

// A peak that only just beats the rest of the curve is a coincidence, not an
// answer — the whole point of the confidence test.
assert.ok(!synced({ offset: 12, speed: 1, score: 0.4, confidence: 2 }), 'a peak in the crowd is no answer')
assert.ok(synced({ offset: 12, speed: 1, score: 0.4, confidence: 9 }), 'one standing clear of it is')

// The look, as mpv properties. Colours are the trap: mpv reads #AARRGGBB, so a
// plain #rrggbb from the picker lands one channel out and the text goes cyan.
const style = subtitleProps(SUBTITLE_DEFAULTS)
assert.equal(style['sub-color'], '#ffffffff')
assert.equal(style['sub-outline-color'], '#ff000000')
assert.equal(style['sub-back-color'], '#00000000', 'no box asked for, so a fully transparent one')
assert.equal(style['sub-border-style'], 'outline-and-shadow')
assert.equal(style['sub-font-size'], SUBTITLE_DEFAULTS.size)

const boxed = subtitleProps({ ...SUBTITLE_DEFAULTS, background: 0.5, color: '#f2e14c' })
assert.equal(boxed['sub-back-color'], '#80000000', 'half-opaque black behind the text')
assert.equal(boxed['sub-border-style'], 'background-box', 'the box only draws in this style')
assert.equal(boxed['sub-color'], '#fff2e14c')

// The same look as CSS, for the <video> player. mpv sizes against a 720-tall
// window, so both have to scale from there or the settings preview would only
// be honest on one of them.
assert.equal(subtitleCss(SUBTITLE_DEFAULTS, 720).fontSize, '38.0px')
assert.equal(subtitleCss(SUBTITLE_DEFAULTS, 1440).fontSize, '76.0px', 'twice the box, twice the type')
assert.equal(subtitleCss(SUBTITLE_DEFAULTS, 0).fontSize, '38.0px', 'an unmeasured box falls back to 720')
assert.equal(subtitleCss(SUBTITLE_DEFAULTS, 720).backgroundColor, 'transparent', 'no box asked for')
assert.equal(subtitleCss({ ...SUBTITLE_DEFAULTS, background: 0.5 }, 720).backgroundColor, 'rgba(0,0,0,0.5)')

// Every offered font has to reach the webview as something it can actually
// draw. A bare family name it hasn't got is not a near miss — it falls back to
// the browser's default serif, so the choice silently does nothing. Roboto is
// the one the app carries itself, and @fontsource-variable registers it under a
// name of its own; the rest have to name the generic they are a kind of, which
// is also what fontconfig hands mpv on a machine without them.
for (const font of SUBTITLE_FONTS) {
  const stack = subtitleFontCss(font)
  assert.ok(stack.startsWith(font) || stack.includes(`'${font} Variable'`), `${font} leads its own stack`)
  assert.ok(
    /(?:^|[\s,])(?:sans-serif|serif|monospace)$/.test(stack),
    `${font} ends in a generic the webview always has, got "${stack}"`,
  )
}
assert.equal(
  subtitleFontCss('Roboto'),
  `'Roboto Variable', Roboto, sans-serif`,
  'the bundled family is named first — plain Roboto misses it and is not installed on a desktop',
)
assert.equal(subtitleCss({ ...SUBTITLE_DEFAULTS, font: 'Georgia' }, 720).fontFamily, 'Georgia, Times, serif')

// Lifting the line clear of the player's menu, which otherwise covers it —
// mpv's subtitles are drawn inside its own window, under everything the page
// puts on top of it.
assert.equal(subtitleLift(100, 0, 1080), 100, 'nothing in the way, nothing moves')
assert.equal(subtitleLift(100, 400, 1080), 100 - 400 / 1080 * 100, 'just above a 400px panel')
assert.equal(subtitleLift(60, 200, 1080), 60, 'a line already above the panel keeps the user\'s own position')
assert.equal(subtitleLift(100, 900, 1080), 35, 'a tall panel never parks the text mid-frame')
assert.equal(subtitleLift(100, 400, 0), 100, 'an unmeasured box leaves the position alone')

// Which line is on screen. Overlaps are both speakers talking, not a choice.
const lines = [
  { start: 1, end: 3, text: 'first' },
  { start: 2.5, end: 4, text: 'second' },
  { start: 9, end: 10, text: 'later' },
]
assert.equal(cueAt(lines, 0.5), '', 'before anything is said')
assert.equal(cueAt(lines, 1), 'first', 'a cue is on from its own start')
assert.equal(cueAt(lines, 2.7), 'first\nsecond')
assert.equal(cueAt(lines, 3), 'second', 'and off at its end, not one frame after')
assert.equal(cueAt(lines, 6), '', 'a gap is a gap')
assert.equal(cueAt([], 6), '')

// The settings picker offers 639-1 codes (the app's locale list) while a track
// or an addon names the same language in 639-2 — sometimes twice over, as
// Intl's "bibliographic" and "terminological" pairs. Nothing anywhere compares
// codes for exactly this reason; both sides go through `langName` and compare
// the name. Bound to the raw code instead, a stored "eng" matched no item in
// the list and the field showed the code itself.
for (const [short, ...long] of [['en', 'eng'], ['sl', 'slv'], ['de', 'deu', 'ger'], ['fr', 'fra', 'fre']]) {
  for (const code of long)
    assert.equal(langName(code!), langName(short!), `${code} and ${short} are one language`)
}

// A flag beside a language is one of the language picker's — the only pictures
// the bundle carries — found by the name both codes resolve to.
const FLAGS = { en: 'flag:us', de: 'flag:de', pt: 'flag:br', zh: 'flag:cn' }
assert.equal(langFlag('ger', FLAGS), 'flag:de', 'an mkv\'s bibliographic code finds its flag')
assert.equal(langFlag('deu', FLAGS), 'flag:de', 'and so does the terminological one')
assert.equal(langFlag('pob', FLAGS), 'flag:br', 'and OpenSubtitles\' own code for a variety, by what it is a variety of')
assert.equal(langFlag('zht', FLAGS), 'flag:cn')
assert.equal(langFlag('aka', FLAGS), undefined, 'a language the app has no locale for has no flag')
assert.equal(langFlag('', FLAGS), undefined, 'and a track that names no language has none either')

// ---------------------------------------------------------------------------
// The "choose subtitles for me" seam, which is a template and a store rather
// than a function anything out here can call — three files that have to agree
// about one pair of keys, and nothing but this notices when they stop.
// ---------------------------------------------------------------------------
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const player = read('../app/components/MpvPlayer.vue')
const store = read('../app/stores/settings.ts')
const page = read('../app/pages/settings/subtitles.vue')

// One value, one place. Two `useLocalStorage` refs on the same key do not see
// each other inside a document — the storage event is for other tabs — so a
// second one here would leave the settings page editing a copy that the running
// player never reads. Each person's, so through `scoped()` (see utils/profiles).
assert.ok(store.includes('useLocalStorage(scoped(\'ventic.subLang\')'), 'the store owns the chosen language')
assert.ok(store.includes('useLocalStorage(scoped(\'ventic.autoSubs\')'), 'and whether to apply it at all')
assert.ok(
  !player.includes('\'ventic.subLang\''),
  'and the player reads it off the store rather than keeping a second copy of the key',
)
for (const key of ['autoSubs', 'subLang'])
  assert.ok(page.includes(`settings.${key}`), `the settings page edits ${key}`)

// The switch is what decides whether a film opens with subtitles: without this
// test, dropping the guard silently restores "whatever you last picked, always".
// The one thing ahead of it is what a cast brought, which the sending screen
// had on — and nothing else is.
const preferred = player.slice(player.indexOf('async function applyPreferredSub()'))
const guard = preferred.indexOf('if (!settings.autoSubs || !subLang.value)')
assert.ok(guard > 0 && !/loadFile|setSid|fetchExternals|keptSubtitle/.test(preferred.slice(0, guard).replace('applyHanded(cast.subtitle)', '')), 'nothing is applied while the switch is off')
assert.ok(preferred.indexOf('return applyHanded(cast.subtitle)') < guard, 'but what a cast brought')

// The player edits the same setting the page does, so turning subtitles off
// mid-film means off next time too — which is what clearing the remembered
// language used to do, back when the language was the only state there was.
assert.match(player, /function subsOff\(\)[\s\S]{0,120}settings\.autoSubs = false/, 'off means off next time')
assert.match(player, /function prefer\(code: string\)[\s\S]{0,120}settings\.autoSubs = true/, 'and picking one turns it back on')

// A remote opens the panel from the bottom bar and has to land inside it. The
// marker and the query are in two files' worth of distance from each other.
assert.ok(player.includes('data-menu-list'), 'the menu list is marked for the focus that follows an open')
assert.match(player, /querySelector<HTMLElement>\('\[data-menu-list\] button'\)/, 'and openMenu focuses the first row in it')

// The hard-of-hearing toggle sat under however many languages OpenSubtitles
// answered with — forty rows of scrolling on a TV for a two-state switch. It
// and the timing are tabs of their own now, and the panel opens on choosing.
assert.ok(
  player.indexOf('Hide sound descriptions') < player.lastIndexOf('OpenSubtitles'),
  'the text and timing controls come before the language list, not under it',
)
assert.match(player, /menu\.value = name\n\s+subTab\.value = 'language'/, 'the subtitle panel always opens on choosing')
assert.ok(page.includes('subs.hideCaptions'), 'and the same toggle is on the settings page')

// ---------------------------------------------------------------------------
// SubDL, behind the user's own key. The built-in addon is a thin copy — nine
// languages and no English for Philosopher's Stone — so this is where the depth
// comes from, and everything below runs against a fake of its API.
// ---------------------------------------------------------------------------

// Its codes are ISO 639-1 upper-cased, and a language reaches the search as
// whatever last named it: the settings list's "sl", OpenSubtitles' "slv", an
// mkv's bibliographic "ger" (which Intl will not canonicalise), a locale tag.
for (const [code, want] of [['sl', 'SL'], ['slv', 'SL'], ['ger', 'DE'], ['deu', 'DE'], ['cze', 'CS'], ['slo', 'SK'], ['en-US', 'EN'], ['pob', 'BR_PT'], ['zht', 'ZH_BG'], ['', '']])
  assert.equal(subdlCode(code!), want, `${code} is ${want} to SubDL`)

const realFetch = globalThis.fetch
/** Every request the fake answered, and how: by the parameters SubDL reads. */
let asked: URL[] = []
function subdlFile(language: string, n: number, extra: Record<string, unknown> = {}) {
  return { language, url: `/subtitle/${language}-${n}.zip`, release_name: `Film.2001.${language}.${n}`, ...extra }
}

function fakeSubdl(answer: (q: URLSearchParams) => Response) {
  asked = []
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input))
    asked.push(url)
    if (url.host === 'opensubtitles-v3.strem.io')
      return Response.json({ subtitles: [{ id: 'os', url: 'https://subs5.strem.io/slv', lang: 'slv' }] })
    if (url.host === 'api.subdl.com')
      return answer(url.searchParams)
    throw new Error(`nothing fakes ${url}`)
  }) as typeof fetch
}
const subdlAsks = () => asked.filter(u => u.host === 'api.subdl.com' && u.pathname.endsWith('/subtitles')).map(u => u.searchParams)

// A film with seven pages: the first five are read, and the preferred language
// is asked for by itself besides, because those five pages may not reach it.
fakeSubdl(q => Response.json({
  status: true,
  totalPages: 7,
  subtitles: q.get('languages') === 'SL'
    ? [subdlFile('SL', 1), subdlFile('SL', 2)]
    : [subdlFile('EN', Number(q.get('page'))), subdlFile('BR_PT', Number(q.get('page'))), subdlFile('SL', 1)],
}))
const film = await findSubtitles('tt0241527', 0, 0, '', { subdl: 'k', lang: 'slv' })
const filmAsks = subdlAsks()
assert.deepEqual(filmAsks.map(q => q.get('page')).sort(), ['1', '1', '2', '3', '4', '5'], 'five pages and the language of choice')
assert.ok(filmAsks.every(q => q.get('imdb_id') === 'tt0241527' && q.get('type') === 'movie' && q.get('api_key') === 'k'))
assert.equal(filmAsks.filter(q => q.get('languages')).length, 1, 'only the language of choice is asked by language')
assert.ok(asked.some(u => u.host === 'opensubtitles-v3.strem.io'), 'the built-in addon is still asked')
const filmLangs = byLanguage(film)
assert.deepEqual(filmLangs.map(l => l.name), ['English', 'Portuguese (Brazil)', 'Slovenian'])
// One language, one row, whoever answered: OpenSubtitles' "slv" and SubDL's
// "SL" are both Slovenian, and the same file twice is one file.
const slovenian = filmLangs.find(l => l.name === 'Slovenian')!
assert.equal(slovenian.files.length, 3, 'two from SubDL and one from the addon, the repeat dropped')
const sl1 = slovenian.files.find(f => f.url === 'https://dl.subdl.com/subtitle/SL-1.zip')!
assert.equal(sl1.name, 'Film.2001.SL.1', 'SubDL names its files, which is what tells two of them apart')
assert.ok(sl1.metered, 'and counts every one of them handed out')

// Its account page says how many of the 50 are left — the count a row that
// would spend one shows.
fakeSubdl(q => q.has('api_key') && !q.has('type')
  ? Response.json({ status: true, apiAccount: { downloads: { remaining: 36 } } })
  : Response.json({ status: true, subtitles: [] }))
await findSubtitles('tt0241527', 0, 0, '', { subdl: 'k' })
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(quota.SubDL, 36)
assert.equal(fileNote({ id: 'q', url: 'https://dl.subdl.com/q.zip', lang: 'sl', metered: true, provider: 'SubDL', cues: [], captions: true, unread: true }), 'SubDL · 36 left today · SDH')

// A refused key is SubDL failing, not the search: the addon's list still shows.
fakeSubdl(() => Response.json({ status: false, error: 'Not Authorized' }, { status: 403 }))
assert.deepEqual((await findSubtitles('tt0241527', 0, 0, '', { subdl: 'bad' })).map(s => s.lang), ['slv'])
// With nothing else asked, it is the search failing, and says why.
await assert.rejects(findSubtitles('', 0, 0, '', { subdl: 'bad', title: 'Film' }), /SubDL answered HTTP 403 — Not Authorized/)
// And with no id and no key there is nothing to ask — an empty answer, not a
// failure with "undefined" for a reason.
assert.deepEqual(await findSubtitles(''), [])

// No IMDb id is what a bare magnet usually has, and the addon can do nothing
// with that. SubDL goes by TMDB's id, or else by the name — which it refuses
// with an apostrophe in it, and indexes one as a space.
fakeSubdl(() => Response.json({ status: true, subtitles: [] }))
await findSubtitles('', 0, 0, '', { subdl: 'k', tmdbId: 671 })
assert.ok(!asked.some(u => u.host === 'opensubtitles-v3.strem.io'), 'the addon is not asked without an id')
assert.ok(subdlAsks().every(q => q.get('tmdb_id') === '671' && !q.has('film_name')))
asked = []
await findSubtitles('', 0, 0, '', { subdl: 'k', title: 'Harry Potter and the Philosopher\'s Stone', year: '2001' })
assert.ok(subdlAsks().every(q => q.get('film_name') === 'Harry Potter and the Philosopher s Stone' && q.get('year') === '2001'))
// "Can't find" is an answer rather than a failure.
fakeSubdl(() => Response.json({ status: false, error: 'can\'t find movie or tv' }))
assert.deepEqual(await findSubtitles('', 0, 0, '', { subdl: 'k', title: 'Nothing' }), [])

// An episode: another episode's file is dropped, a range only if ours is
// outside it, and one with no number at all is the whole season — kept, with
// our episode on it so the archive gives up the right file.
fakeSubdl(() => Response.json({
  status: true,
  subtitles: [
    subdlFile('SL', 1, { episode: 3 }),
    subdlFile('SL', 2, { episode: 4 }),
    subdlFile('SL', 3, { episode_from: 1, episode_end: 10 }),
    subdlFile('SL', 4, { episode_from: 5, episode_end: 8 }),
    subdlFile('SL', 5, {}),
  ],
}))
const episode = await findSubtitles('tt0944947', 1, 3, '', { subdl: 'k', lang: 'sl' })
assert.ok(subdlAsks().every(q => q.get('type') === 'tv' && q.get('season_number') === '1' && q.get('episode_number') === '3'))
assert.deepEqual(
  [...new Set(episode.filter(s => s.metered).map(s => s.url.split('/').pop()))].sort(),
  ['SL-1.zip', 'SL-3.zip', 'SL-5.zip'],
)
assert.ok(episode.filter(s => s.metered).every(s => s.episode === 3))

// Within a language files are tried in order, so a release name sharing the
// playing file's group, source and resolution goes first. SubDL's `hi` is the
// hearing-impaired flag, which the row has to show before anything is read.
fakeSubdl(() => Response.json({
  status: true,
  subtitles: [
    subdlFile('SL', 1, { release_name: 'Film.2001.WEBRip.iTunes' }),
    subdlFile('SL', 2, { release_name: 'Film.2001.1080p.BluRay.x264-GRP', hi: true }),
    subdlFile('SL', 3, { release_name: 'Film.2001.1080p.BluRay.DTS.x264-hV', hi: false }),
  ],
}))
const ranked = (await findSubtitles('tt0241527', 0, 0, 'Film.2001.1080p.BluRay.x264-GRP.mkv', { subdl: 'k' })).filter(s => s.metered)
assert.deepEqual(ranked.map(s => s.name), ['Film.2001.1080p.BluRay.x264-GRP', 'Film.2001.1080p.BluRay.DTS.x264-hV', 'Film.2001.WEBRip.iTunes'])
assert.deepEqual(ranked.map(s => !!s.captions), [true, false, false])

// The archives themselves, written by Python's zipfile — a reference writer,
// not this file's idea of the format:
//   film: deflated, `film.srt` in Windows-1250 beside a macOS `__MACOSX/._film.srt`
//   pack: written as a stream (sizes only after the data, as SubDL's packer may
//         well do), S01E01 and S01E02
const FILM_ZIP = 'UEsDBBQAAAAIAOKGYV19jgp3CgAAAAgAAAATAAAAX19NQUNPU1gvLl9maWxtLnNydGNgFWPPKs3LBgBQSwMEFAAAAAgA4oZhXVZawIY6AAAAVQAAAAgAAABmaWxtLnNydDPkMjCwAiFDHQMDAwVdXTsFqIAJSICrKz8nUeFFYlF+WV5mFheXEUi5CUgBsnKQgDFYuXd+XmoyFwBQSwECFAMUAAAACADihmFdfY4KdwoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAX19NQUNPU1gvLl9maWxtLnNydFBLAQIUAxQAAAAIAOKGYV1WWsCGOgAAAFUAAAAIAAAAAAAAAAAAAACAATsAAABmaWxtLnNydFBLBQYAAAAAAgACAHcAAACbAAAAAAA='
const PACK_ZIP = 'UEsDBBQACAAIAOKGYV0AAAAAAAAAAAAAAAAPAAAAU2hvdy5TMDFFMDEuc3J0M+QyMLACIUMdAwMDBV1dOwWogAlIgMu1ILMqPyVRwZCLywik1AQkiawUJGAMVuqdn5eazAUAUEsHCEFRJNs2AAAAUQAAAFBLAwQUAAgACADihmFdAAAAAAAAAAAAAAAADwAAAFNob3cuUzAxRTAyLnNydDPkMjCwAiFDHQMDAwVdXTsFqIAJSIDLtSCzKj8lUcGIi8sIpNQEJImsFCRgDFbqnZ+XmswFAFBLBwjj5m04NgAAAFEAAABQSwECFAMUAAgACADihmFdQVEk2zYAAABRAAAADwAAAAAAAAAAAAAAgAEAAAAAU2hvdy5TMDFFMDEuc3J0UEsBAhQDFAAIAAgA4oZhXePmbTg2AAAAUQAAAA8AAAAAAAAAAAAAAIABcwAAAFNob3cuUzAxRTAyLnNydFBLBQYAAAAAAgACAHoAAADmAAAAAAA='
const served: Record<string, Uint8Array | string> = {
  'https://dl.subdl.com/film.zip': Buffer.from(FILM_ZIP, 'base64'),
  'https://dl.subdl.com/pack.zip': Buffer.from(PACK_ZIP, 'base64'),
  'https://dl.subdl.com/pack-e2.zip': Buffer.from(PACK_ZIP, 'base64'),
  'https://dl.subdl.com/pack-e5.zip': Buffer.from(PACK_ZIP, 'base64'),
  'https://dl.subdl.com/bare.srt': '1\n00:00:01,000 --> 00:00:02,000\nNot in an archive\n',
  'https://dl.subdl.com/pick.zip': Buffer.from(FILM_ZIP, 'base64'),
  'https://dl.subdl.com/sdh.zip': Buffer.from(FILM_ZIP, 'base64'),
  'https://subs5.strem.io/free.srt': '1\n00:00:01,000 --> 00:00:02,000\nZastonj\n',
  // Windows-1250 bytes for "Žaba", served as they were uploaded.
  'http://127.0.0.1:3030/torrents/1/stream/3': new Uint8Array([...Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n'), 0x8E, 0x61, 0x62, 0x61, 0x0A]),
}
const downloads: string[] = []
globalThis.fetch = (async (input: string | URL) => {
  downloads.push(String(input))
  const body = served[String(input)]
  return body === undefined ? new Response('', { status: 404 }) : new Response(body)
}) as typeof fetch

const fromZip = await probe({ id: 'f', url: 'https://dl.subdl.com/film.zip', lang: 'sl', metered: true })
assert.equal(fromZip.cues.length, 2, 'the subtitle comes out of the archive, not the macOS shadow beside it')
assert.equal(fromZip.cues[0]!.text, 'Šola čarovnij', 'and a Slovenian file not in UTF-8 is read as Windows-1250')
// mpv can't open a zip over http, so it gets the text through its own
// `memory://` — checked by hand against mpv 0.41 over IPC, accents and all.
assert.equal(await mpvSource(fromZip), `memory://${fromZip.text}`)
assert.ok(fromZip.text!.startsWith('1\n00:00:01,000'))
const plain = { id: 'p', url: 'https://subs5.strem.io/plain', lang: 'eng' }
assert.equal(await mpvSource(plain), plain.url, 'a file mpv can read is handed over as a url, without a download first')

assert.equal((await probe({ id: 'e2', url: 'https://dl.subdl.com/pack-e2.zip', lang: 'sl', metered: true, episode: 2 })).cues[0]!.text, 'Epizoda 2')
// Any episode of the season would fit the runtime as well as ours does, so a
// pack without ours in it gives up nothing rather than its first file.
assert.equal((await probe({ id: 'e5', url: 'https://dl.subdl.com/pack-e5.zip', lang: 'sl', metered: true, episode: 5 })).cues.length, 0)
assert.equal((await probe({ id: 'b', url: 'https://dl.subdl.com/bare.srt', lang: 'en', metered: true })).cues[0]!.text, 'Not in an archive', 'the odd bare file still reads')

// Every metered file read is one of a day's downloads — SubDL's 50 a key,
// OpenSubtitles' 5 a household — and picking a language used to read a dozen.
// Now the free files are read and the metered ones listed on the provider's
// word, behind every free file that fits, even the captioned cut: "choose
// automatically" picks what it picked before there were any. Of the metered,
// SubDL's go first. A file that won't read sinks below all.
served['https://subs5.strem.io/free-sdh.srt'] = Array.from({ length: 10 }, (_, i) => `${i + 1}\n00:00:${10 + i},000 --> 00:00:${10 + i},900\n[GLASBA]\n`).join('\n')
downloads.length = 0
const shelf = await probeLanguage(byLanguage([
  { id: 'gone', url: 'https://subs5.strem.io/gone', lang: 'slv' },
  { id: 'os', url: 'https://www.opensubtitles.com/sl/subtitles/1', lang: 'sl', name: 'Film.720p', metered: true, provider: 'OpenSubtitles' },
  { id: 'sdh', url: 'https://dl.subdl.com/sdh.zip', lang: 'sl', name: 'Film.SDH', metered: true, provider: 'SubDL', captions: true },
  { id: 'pick', url: 'https://dl.subdl.com/pick.zip', lang: 'sl', name: 'Film.1080p', metered: true, provider: 'SubDL' },
  { id: 'freeSdh', url: 'https://subs5.strem.io/free-sdh.srt', lang: 'slv' },
  { id: 'free', url: 'https://subs5.strem.io/free.srt', lang: 'slv' },
])[0]!)
assert.deepEqual(downloads.sort(), ['https://subs5.strem.io/free-sdh.srt', 'https://subs5.strem.io/free.srt', 'https://subs5.strem.io/gone'], 'no metered file is downloaded to list them')
assert.deepEqual(shelf.map(f => f.id), ['free', 'freeSdh', 'pick', 'sdh', 'os', 'gone'])
assert.deepEqual(shelf.slice(2).map(fileNote), ['SubDL · 36 left today', 'SubDL · 36 left today · SDH', 'OpenSubtitles', 'Unreadable'], 'and each that would cost one says how many are left')

// The pick is the download, once: mpv's copy and the cues' copy are asked for
// together, and the row it was picked from becomes what it turned out to be.
downloads.length = 0
const [picked, forMpv] = await Promise.all([probe(shelf[2]!), mpvSource(shelf[2]!)])
assert.deepEqual(downloads, ['https://dl.subdl.com/pick.zip'], 'one download for both')
assert.equal(forMpv, `memory://${picked.text}`)
assert.equal(picked.cues.length, 2)
assert.ok(!picked.unread && !fileNote(picked).startsWith('SubDL'), 'its row now says what it runs to')
assert.equal((await probeLanguage(byLanguage([shelf[2]!])[0]!))[0]!.cues.length, 2, 'and stays read')
assert.deepEqual(downloads, ['https://dl.subdl.com/pick.zip'])

// SubDL counts a download by the key in its url and says how many are left
// only on its account page, so its own download takes the count down by one.
served['https://dl.subdl.com/subtitle/SL-1.zip'] = Buffer.from(FILM_ZIP, 'base64')
const subdlLeft = quota.SubDL!
assert.equal((await probe(sl1)).cues.length, 2)
assert.equal(quota.SubDL, subdlLeft - 1)

// A season's archive is one url for every episode in it, and each episode is
// its own file: the second one played must not get the first one's lines.
const e1 = await probe({ id: 's1', url: 'https://dl.subdl.com/pack.zip', lang: 'sl', metered: true, episode: 1 })
const e2 = await probe({ id: 's2', url: 'https://dl.subdl.com/pack.zip', lang: 'sl', metered: true, episode: 2 })
assert.deepEqual([e1.cues[0]!.text, e2.cues[0]!.text], ['Epizoda 1', 'Epizoda 2'])
const [e3] = await probeLanguage(byLanguage([{ id: 's3', url: 'https://dl.subdl.com/pack.zip', lang: 'sl', metered: true, provider: 'SubDL', episode: 3 }])[0]!)
assert.ok(e3!.unread, 'and a third episode of it is listed unread, not as the one read before')

// One that didn't download is asked again at the next pick: a refused one
// costs nothing, and a TV is left on past the midnight its quota renews at.
served['https://dl.subdl.com/flaky.zip'] = Buffer.from(FILM_ZIP, 'base64')
const servedFetch = globalThis.fetch
let failedOnce = 0
globalThis.fetch = (async (input: string | URL) => String(input).endsWith('/flaky.zip') && !failedOnce++ ? new Response('', { status: 500 }) : servedFetch(input)) as typeof fetch
const flaky = { id: 'fl', url: 'https://dl.subdl.com/flaky.zip', lang: 'sl', metered: true }
assert.equal((await probe(flaky)).cues.length, 0)
assert.equal((await probe(flaky)).cues.length, 2, 'and reads the second time')
globalThis.fetch = servedFetch
// A release's own file arrives as it was written too, and on Android the page
// draws it — so the same guess by language applies, by the code its name gave.
assert.equal((await probe({ id: 'r', url: 'http://127.0.0.1:3030/torrents/1/stream/3', lang: 'slv' })).cues[0]!.text, 'Žaba')

// Before any of this, every file was read as UTF-8 and a stray byte showed as
// one �. That stays true: a file is only re-read in a codepage when it breaks
// as UTF-8 nearly everywhere it isn't plain ASCII, the way a legacy file does.
const strayByte = new Uint8Array([...Buffer.from('Šola čarovnij in žarkov, '.repeat(20)), 0xFF, ...Buffer.from(' konec')])
assert.ok(decodeSubtitle(strayByte, 'sl').startsWith('Šola čarovnij'), 'one broken byte doesn\'t turn a UTF-8 file into mojibake')
assert.equal(decodeSubtitle(new Uint8Array([0x48, 0x69, 0xA0, 0x74, 0x68, 0x65, 0x72, 0x65]), 'en'), 'Hi\u00A0there', 'an English Windows-1252 file still reads')

// ---------------------------------------------------------------------------
// OpenSubtitles' own API, with the app's key from the build: the catalogue the
// built-in addon is a thin copy of. Faked as Bazarr's client and IINA's plugin
// use it — a GET to search, a POST per file, and the file at the link it gives.
// ---------------------------------------------------------------------------

let osAsked: { url: URL, init?: RequestInit }[] = []
let turnedAway = 0
function osItem(language: string, id: number, extra: Record<string, unknown> = {}) {
  return { attributes: { language, release: `Film.2001.${language}.${id}`, url: `https://www.opensubtitles.com/en/subtitles/${id}`, files: [{ file_id: id, file_name: `film-${id}.srt` }], ...extra } }
}
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  osAsked.push({ url, init })
  if (url.host === 'opensubtitles-v3.strem.io')
    return Response.json({ subtitles: [] })
  if (url.pathname === '/api/v1/subtitles') {
    if ((init?.headers as Record<string, string>)['Api-Key'] === 'bad')
      return Response.json({ message: 'You cannot consume this service' }, { status: 403 })
    // Five requests a second, and a search is six: a burst loses one, once.
    const page = url.searchParams.get('page')
    if (page === '2' && !turnedAway++)
      return new Response('', { status: 429, headers: { 'retry-after': '0' } })
    return Response.json({
      total_pages: 2,
      data: url.searchParams.get('languages') === 'es,sp'
        ? [osItem('es', 11), osItem('sp', 12)]
        : url.searchParams.get('languages')
          ? [osItem('sl', 1)]
          : page === '2'
            ? [osItem('fi', 7)]
            : [osItem('en', 2), osItem('pt-BR', 3, { hearing_impaired: true }), osItem('sl', 1), osItem('sl', 4, { foreign_parts_only: true }), osItem('de', 9)],
    })
  }
  if (url.pathname === '/api/v1/download') {
    const { file_id } = JSON.parse(String(init?.body))
    return file_id === 9
      ? Response.json({ message: 'You have downloaded your allowed 5 subtitles for 24h.Your quota will be renewed in 5 hours and 13 minutes (2026-11-01 23:59:59 UTC) ts=1793558796 ', remaining: -1 }, { status: 406 })
      : Response.json({ link: `https://dl.opensubtitles.com/file/${file_id}.srt`, remaining: 99 })
  }
  if (url.host === 'dl.opensubtitles.com')
    return new Response('1\n00:00:01,000 --> 00:00:02,000\nČarovnik\n')
  throw new Error(`nothing fakes ${url}`)
}) as typeof fetch
const osSearches = () => osAsked.filter(r => r.url.pathname === '/api/v1/subtitles').map(r => r.url.searchParams)

// The search: the IMDb id as a bare number, the AI translations left out, the
// language of choice by itself besides, the key in its header — and the
// parameters sorted, since any other order is answered with a redirect.
const fromOs = await findSubtitles('tt0241527', 0, 0, '', { opensubtitles: 'app-key', lang: 'slv' })
assert.deepEqual(osSearches().map(q => q.get('page')).sort(), ['1', '1', '2', '2'], 'both pages, the language of choice, and the page turned away asked again')
assert.ok(osSearches().every(q => q.get('imdb_id') === '241527' && q.get('ai_translated') === 'exclude'))
assert.ok(osSearches().every(q => [...q.keys()].join() === [...q.keys()].sort().join()), 'in alphabetical order')
assert.deepEqual(osSearches().flatMap(q => q.get('languages') ?? []), ['sl'])
assert.ok(osAsked.filter(r => r.url.host === 'api.opensubtitles.com').every(r => (r.init?.headers as Record<string, string>)['Api-Key'] === 'app-key'))

// Its language codes are 639-1, but Portuguese and Chinese always name the
// variety — and the file that only translates the foreign parts is dropped.
const osLangs = byLanguage(fromOs)
assert.deepEqual(osLangs.map(l => l.name), ['English', 'Finnish', 'German', 'Portuguese (Brazil)', 'Slovenian'], 'the second page included, though it was turned away once')
const osSl = osLangs.find(l => l.name === 'Slovenian')!
assert.deepEqual(osSl.files.map(f => [f.name, f.provider, f.metered]), [['Film.2001.sl.1', 'OpenSubtitles', true]], 'one file however often it came, and no forced track')
assert.equal(osLangs.find(l => l.name === 'Portuguese (Brazil)')!.files[0]!.captions, true)
osAsked = []
await findSubtitles('tt0241527', 0, 0, '', { opensubtitles: 'k', lang: 'pob' })
assert.ok(osSearches().some(q => q.get('languages') === 'pt-br'), 'and asked for by the variety\'s name')
// Its Spanish is two codes, one of them its own invention: asked for by both,
// and listed as one language rather than as a bare "sp".
osAsked = []
const osEs = byLanguage(await findSubtitles('tt0241527', 0, 0, '', { opensubtitles: 'k', lang: 'es' }))
assert.ok(osSearches().some(q => q.get('languages') === 'es,sp'))
assert.deepEqual(osEs.find(l => l.name === 'Spanish')?.files.map(f => f.id), ['opensubtitles:11', 'opensubtitles:12'])
assert.ok(!osEs.some(l => l.name === 'sp'))

// Listing costs nothing; the pick is one POST, for mpv and the cues together,
// and mpv gets the text — the url is the subtitle's page, not its file.
osAsked = []
const [osRow] = await probeLanguage(osSl)
assert.equal(fileNote(osRow!), 'OpenSubtitles')
assert.equal(osAsked.length, 0, 'listing them downloads nothing')
const [osRead, osMpv] = await Promise.all([probe(osRow!), mpvSource(osRow!)])
const posts = osAsked.filter(r => r.url.pathname === '/api/v1/download')
assert.equal(posts.length, 1, 'one download for both')
assert.deepEqual(JSON.parse(String(posts[0]!.init!.body)), { file_id: 1 })
assert.equal(osRead.cues[0]!.text, 'Čarovnik')
assert.equal(osMpv, `memory://${osRead.text}`)
// A spent quota is a refusal, not a link, and says when the five come back:
// the row shows that, minus the stamp it carries for their own logs.
const spent = await probe(osLangs.find(l => l.name === 'German')!.files[0]!)
assert.equal(spent.cues.length, 0)
assert.equal(fileNote(spent), 'You have downloaded your allowed 5 subtitles for 24h. Your quota will be renewed in 5 hours and 13 minutes (2026-11-01 23:59:59 UTC)')

// No IMDb id: TMDB's, or the name — and a show by its own id, with the episode.
osAsked = []
await findSubtitles('', 0, 0, '', { opensubtitles: 'k', tmdbId: 671 })
assert.ok(osSearches().every(q => q.get('tmdb_id') === '671' && !q.has('imdb_id') && !q.has('query')))
osAsked = []
await findSubtitles('', 0, 0, '', { opensubtitles: 'k', title: 'Harry Potter and the Philosopher\'s Stone', year: '2001' })
assert.ok(osSearches().every(q => q.get('query') === 'harry potter and the philosopher\'s stone' && q.get('year') === '2001'))
osAsked = []
await findSubtitles('tt0944947', 1, 3, '', { opensubtitles: 'k' })
assert.ok(osSearches().every(q => q.get('parent_imdb_id') === '944947' && q.get('season_number') === '1' && q.get('episode_number') === '3' && !q.has('imdb_id')))
// A key it refuses is that provider failing, not the search.
assert.deepEqual(await findSubtitles('tt0241527', 0, 0, '', { opensubtitles: 'bad' }), [])
await assert.rejects(findSubtitles('', 0, 0, '', { opensubtitles: 'bad', title: 'Film' }), /OpenSubtitles answered HTTP 403 — You cannot consume this service/)

// ---------------------------------------------------------------------------
// SubSource, with the user's key: 7200 requests a key a day, a download one of
// them. Faked as it answered on 2026-11-01 — a title id first (a show's is one
// a season), then files whose release names say which episode they are for.
// ---------------------------------------------------------------------------

for (const [code, want] of [['sl', 'slovenian'], ['slv', 'slovenian'], ['pob', 'brazilian_portuguese'], ['fa', 'farsi_persian'], ['en', 'english'], ['ger', 'german'], ['bn', 'bengali'], ['', '']])
  assert.equal(subsourceName(code!), want, `${code} is ${want} to SubSource`)

let ssAsked: URL[] = []
let ssDayLeft = 7200
let ssTurnedAway = 0
function ssItem(language: string, id: number, release: string, extra: Record<string, unknown> = {}) {
  return { subtitleId: id, language, releaseInfo: [release], hearingImpaired: false, foreignParts: false, link: `/subtitle/${language}/${id}`, ...extra }
}
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  ssAsked.push(url)
  if (url.host === 'opensubtitles-v3.strem.io')
    return Response.json({ subtitles: [] })
  if ((init?.headers as Record<string, string>)['X-API-Key'] === 'bad')
    return Response.json({ error: 'Invalid API key', message: 'The provided API key is invalid or inactive' }, { status: 401 })
  const headers = { 'x-ratelimit-remaining-day': String(--ssDayLeft) }
  if (url.pathname.endsWith('/movies/search')) {
    if (url.searchParams.get('searchType') === 'text')
      return Response.json({ data: [{ movieId: 2, releaseYear: 2004, season: null }, { movieId: 1, releaseYear: 2001, season: null }] }, { headers })
    return Response.json({ data: url.searchParams.get('season') ? [{ movieId: 9, season: 1 }] : [{ movieId: 1, releaseYear: 2001, season: null }] }, { headers })
  }
  if (url.pathname.endsWith('/subtitles')) {
    // Sixty a minute: a burst loses one, and the answer says when to come back.
    if (url.searchParams.get('page') === '2' && !ssTurnedAway++)
      return new Response('', { status: 429, headers: { 'x-ratelimit-reset': new Date().toISOString() } })
    const data = url.searchParams.get('movieId') === '9'
      ? [ssItem('english', 90, 'Show.S01E02.1080p.WEB'), ssItem('english', 91, 'Show.S01E03.1080p.WEB'), ssItem('english', 92, 'Show.S01.1080p.WEB'), ssItem('english', 93, 'Show.S01E02.Signs', { foreignParts: true })]
      : url.searchParams.get('language') === 'slovenian'
        ? [ssItem('slovenian', 11, 'Film.2001.1080p.BluRay')]
        : url.searchParams.get('page') === '2'
          ? [ssItem('farsi_persian', 12, 'Film.2001.WEB')]
          : [ssItem('english', 10, 'Film.2001.720p', { hearingImpaired: true }), ssItem('brazilian_portuguese', 13, 'Film.2001.WEB')]
    return Response.json({ data, pagination: { pages: 2 } }, { headers })
  }
  if (url.pathname.endsWith('/download'))
    return new Response(Buffer.from(url.pathname.includes('/92/') ? PACK_ZIP : FILM_ZIP, 'base64'), { headers })
  throw new Error(`nothing fakes ${url}`)
}) as typeof fetch
const ssPaths = (end: string) => ssAsked.filter(u => u.pathname.endsWith(end)).map(u => u.searchParams)

const fromSs = await findSubtitles('tt0241527', 0, 0, '', { subsource: 'k', lang: 'slv' })
assert.deepEqual(ssPaths('/movies/search').map(q => [q.get('searchType'), q.get('imdb')]), [['imdb', 'tt0241527']])
assert.ok(ssPaths('/subtitles').every(q => q.get('movieId') === '1'))
assert.deepEqual(ssPaths('/subtitles').flatMap(q => q.get('language') ?? []), ['slovenian'], 'the language of choice, by SubSource\'s name for it')
assert.equal(ssPaths('/subtitles').filter(q => q.get('page') === '2').length, 2, 'and the page turned away is asked again')
const ssLangs = byLanguage(fromSs)
assert.deepEqual(ssLangs.map(l => l.name), ['English', 'Persian', 'Portuguese (Brazil)', 'Slovenian'])
const ssEn = ssLangs.find(l => l.name === 'English')!.files[0]!
assert.deepEqual([ssEn.provider, ssEn.metered, ssEn.captions, ssEn.name], ['SubSource', true, true, 'Film.2001.720p'])
assert.equal(quota.SubSource, ssDayLeft, 'every answer says how many of the 7200 are left')
assert.equal(fileNote({ ...ssEn, cues: [], captions: false, unread: true }), `SubSource · ${ssDayLeft} left today`)

// A show: its season's id, then the files for this episode and the season's
// pack — not the next episode, not the forced track — and the pack gives up
// only this episode.
ssAsked = []
const ssEpisode = (await findSubtitles('tt14688458', 1, 2, '', { subsource: 'k' })).filter(f => f.provider === 'SubSource')
assert.deepEqual(ssPaths('/movies/search').map(q => q.get('season')), ['1'], 'a show is looked up a season at a time')
assert.deepEqual(ssEpisode.map(f => f.name), ['Show.S01E02.1080p.WEB', 'Show.S01.1080p.WEB'])
assert.ok(ssEpisode.every(f => f.episode === 2))
assert.equal((await probe(ssEpisode[1]!)).cues[0]!.text, 'Epizoda 2')

// No IMDb id: the name, and the one from that year rather than the first that
// shares the words.
ssAsked = []
await findSubtitles('', 0, 0, '', { subsource: 'k', title: 'Harry Potter and the Philosopher\'s Stone', year: '2001' })
assert.equal(ssPaths('/movies/search')[0]!.get('q'), 'harry potter and the philosopher\'s stone')
assert.ok(ssPaths('/subtitles').every(q => q.get('movieId') === '1'))
// A refused key is that provider failing, not the search.
assert.deepEqual(await findSubtitles('tt0241527', 0, 0, '', { subsource: 'bad' }), [])
await assert.rejects(findSubtitles('', 0, 0, '', { subsource: 'bad', title: 'Film' }), /SubSource answered HTTP 401 — The provided API key is invalid or inactive/)

// Of the ones that would cost a download, the most to spare goes first.
const spend = await probeLanguage(byLanguage([
  { id: 'o', url: 'https://www.opensubtitles.com/x', lang: 'en', metered: true, provider: 'OpenSubtitles' },
  { id: 'd', url: 'https://dl.subdl.com/x.zip', lang: 'en', metered: true, provider: 'SubDL' },
  { id: 's', url: 'https://subsource.net/x', lang: 'en', metered: true, provider: 'SubSource' },
])[0]!)
assert.deepEqual(spend.map(f => f.id), ['s', 'd', 'o'])

// The key travels the way TMDB's does — `.env` here, a secret in CI, a
// placeholder for Flathub — and nothing compiles that agreement.
assert.match(read('../nuxt.config.ts'), /OPENSUBTITLES_API: process\.env\.OPENSUBTITLES_API/, 'the key reaches the bundle from the build')
for (const workflow of ['release', 'flathub'])
  assert.match(read(`../.github/workflows/${workflow}.yml`), /OPENSUBTITLES_API: \$\{\{ secrets\.OPENSUBTITLES_API \}\}/, `${workflow}.yml builds with it`)
assert.ok(['../packaging/flatpak/io.github.ventic.Ventic.yml', '../packaging/flatpak/generate-sources.sh'].every(f => read(f).includes('__OPENSUBTITLES_KEY__')), 'and Flathub by the placeholder both files name')

// The seams: the key reaches the search, the text reaches mpv, and the key
// stays out of every backup file — it is a quota with someone's name on it.
assert.match(player, /findSubtitles\(id, season, episode, videoName\.value, by\)/, 'the player hands the keys to the search')
assert.match(player, /opensubtitles: useRuntimeConfig\(\)\.public\.OPENSUBTITLES_API/, 'the app\'s OpenSubtitles key among them')
assert.match(player, /\['sub-add', native \? await mpvSource\(file\) : file\.url/, 'mpv is handed what it can open')
assert.match(player, /variants\.value\[lang\.name\] = list\.map\(f => f\.url === read\.url \? read : f\)/, 'the row a pick came from learns what it was')
assert.match(player, /const read = file\.metered \? await cues : null\n\s+if \(read && !read\.cues\.length\) \{\n\s+osd\(read\.error/, 'and one that wouldn\'t download is said so, not handed to mpv')
assert.ok(store.includes('useLocalStorage(\'ventic.subdlKey\''), 'the key is one setting')
assert.ok(page.includes('settings.subdlKey'), 'and the subtitle settings page edits it')
assert.match(read('../app/utils/backup.ts'), /const SECRET = new Set\(\[[^\]]*\{PREFIX\}subdlKey`/, 'and no backup carries it')
globalThis.fetch = realFetch

if (process.argv.includes('--live') && process.env.SUBDL_KEY) {
  const key = process.env.SUBDL_KEY
  const both = byLanguage(await findSubtitles('tt0241527', 0, 0, 'Harry.Potter.and.the.Philosophers.Stone.2001.1080p.BluRay.x264.mkv', { subdl: key, lang: 'sl' }))
  const addon = byLanguage(await findSubtitles('tt0241527'))
  console.log(`live: Philosopher's Stone — ${addon.length} languages from the addon, ${both.length} with SubDL: ${both.map(l => `${l.name} ${l.files.length}`).join(', ')}`)
  assert.ok(both.length > addon.length, 'SubDL adds languages')
  // One download a run: the listing is free, the pick is not.
  const sl = (await probeLanguage(both.find(l => l.name === 'Slovenian')!, 152 * 60)).filter(f => f.metered)
  assert.ok(sl.length && sl.every(f => f.unread), 'SubDL\'s Slovenian files are listed without a download')
  const one = await probe(sl[0]!)
  console.log(`live: slovenian from SubDL → ${sl.map(f => f.name).join(' | ')}; the first reads as ${fileNote(one)}`)
  assert.ok(one.cues.length > 500, 'and the one picked opens into a whole film\'s subtitles')
}

// One download a run, against the address's 100 a day. The key is the app's,
// from `.env`: `bun --env-file=.env scripts/check-subtitles.ts --live`.
if (process.argv.includes('--live') && process.env.OPENSUBTITLES_API) {
  const all = await findSubtitles('tt0241527', 0, 0, 'Harry.Potter.and.the.Philosophers.Stone.2001.1080p.BluRay.x264.mkv', { opensubtitles: process.env.OPENSUBTITLES_API, lang: 'sl' })
  const langs = byLanguage(all)
  const sl = langs.find(l => l.name === 'Slovenian')!
  console.log(`live: OpenSubtitles — ${all.length} files in ${langs.length} languages for Philosopher's Stone, ${sl?.files.length ?? 0} of them Slovenian`)
  assert.ok(sl && sl.files.length > 10, 'OpenSubtitles itself has the Slovenian the addon is missing')
  const one = await probe(sl.files[0]!)
  console.log(`live: the first Slovenian one (${one.name}) reads as ${fileNote(one)}`)
  assert.ok(one.cues.length > 500, 'and the one picked opens into a whole film\'s subtitles')
}

if (process.argv.includes('--live')) {
  const found = await findSubtitles('tt1375666')
  const live = byLanguage(found)
  console.log(`live: ${found.length} subtitles in ${live.length} languages, e.g. ${live.slice(0, 5).map(l => l.name).join(', ')}`)
  assert.ok(live.some(l => l.name === 'English'), 'the addon returned English subtitles')

  // There is no Nuxt runtime config out here, so the TMDB half of findImdbId
  // finds no API token and yields nothing — which makes this a test of the
  // Cinemeta backstop on its own, the case TMDB structurally can't answer.
  assert.equal(await findImdbId('Inception', false, '2010'), 'tt1375666', 'the IMDb-backed fallback still resolves a title')

  // Cinemeta answers a fuzzy search with its best guess whatever you asked, and
  // that guess used to be taken. One wrong id is an evening of another film's
  // subtitles, so a name that isn't the name we asked for is now no answer.
  assert.equal(
    await findImdbId('Qwertyuiop Asdfghjkl Zxcvbnm', false, ''),
    '',
    'a search that matched nothing by name answers nothing',
  )

  // Oppenheimer's English list leads with the hearing-impaired cut, which is
  // exactly the case the sort exists for.
  const eng = byLanguage(await findSubtitles('tt15398776')).find(l => l.name === 'English')!
  const files = await probeLanguage(eng)
  console.log('live: english versions →', files.map(f => `${f.captions ? 'SDH' : 'plain'}/${f.cues.length}`).join(' '))
  assert.equal(files[0]!.captions, false, 'plain dialogue is offered first')

  // 180 minutes of film. Sorted against that runtime, whatever ends up on top
  // has to be a file that actually covers it — the whole point of the probe.
  const fitted = await probeLanguage(eng, 180 * 60)
  const off = fitted.filter(f => !fitsRuntime(f, 180 * 60)).length
  console.log(`live: ${off} of ${fitted.length} english files are the wrong length for a 3h film`)
  assert.equal(fitsRuntime(fitted[0]!, 180 * 60), true, 'a file that covers the runtime is offered first')
}

console.log('subtitles: ok')
