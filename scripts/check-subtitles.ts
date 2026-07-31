// Self-check for the subtitle grouping/naming, the file labelling and the
// auto-sync offset search: `bun scripts/check-subtitles.ts`.
// The fixtures are trimmed real responses; pass --live to also hit the addons.

import assert from 'node:assert'
import process from 'node:process'
import {
  bestSync,
  byLanguage,
  cueAt,
  fileLabel,
  fileNote,
  findImdbId,
  findSubtitles,
  fitsRuntime,
  isCaptions,
  langName,
  parseCues,
  probeLanguage,
  releaseSubtitle,
  stripCaptions,
  subRuntime,
  SUBTITLE_DEFAULTS,
  subtitleCss,
  subtitleLift,
  subtitleProps,
  synced,
} from '../app/utils/subtitles'

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

const audio = envelope(1200)

const fix = bestSync(shift(-3), audio, 0)
assert.ok(Math.abs(fix.offset - 3) < 0.3, `early subtitles get pushed back, got ${fix.offset}`)
assert.ok(synced(fix), 'and the fit is trusted')
assert.equal(fix.speed, 1, 'a plain shift needs no rate change')
assert.ok(Math.abs(bestSync(shift(7.5), audio, 0).offset + 7.5) < 0.3, 'late subtitles get pulled forward')
assert.ok(Math.abs(bestSync(shift(-45), audio, 0).offset - 45) < 0.3, 'and a whole scene of drift still lands')

const fine = bestSync(shift(0), audio, 0)
assert.equal(fine.offset, 0)
assert.equal(fine.speed, 1)
assert.ok(synced(fine), 'an in-sync file is recognised as one rather than nudged')

// A file cut for 25 fps PAL against a 23.976 transfer drifts a minute an hour;
// no single delay fixes that, which is what `sub-speed` is for.
const PAL = 25 / 23.976
const drift = bestSync(shift(0, 1 / PAL), audio, 0)
assert.ok(Math.abs(drift.speed - PAL) < 1e-6, `the rate error is found, got ${drift.speed}`)
assert.ok(Math.abs(drift.offset) < 0.5, `and needs no shift on top, got ${drift.offset}`)
assert.ok(synced(drift))

// The window the caller gets to work with is what has played, and a short one
// has enough freedom to fit anywhere. Refusing beats a confident wrong answer.
assert.ok(!synced(bestSync(shift(-3), envelope(200), 0)), 'three minutes is not enough to be sure')
assert.equal(bestSync([], audio, 0).score, 0, 'no cues, no verdict')
assert.equal(bestSync(shift(-3), envelope(10), 0).score, 0, 'and neither is ten seconds')
// Nothing but room tone: every shift correlates exactly as badly as every other.
assert.ok(!synced(bestSync(shift(-3), new Float32Array(6000).fill(-60), 0)), 'silence gives no verdict')

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
