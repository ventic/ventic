// Self-check for the subtitle grouping/naming, the file labelling and the
// auto-sync offset search: `bun scripts/check-subtitles.ts`.
// The fixtures are trimmed real responses; pass --live to also hit the addons.
import type { Interval } from '../app/utils/subtitles'
import assert from 'node:assert'
import process from 'node:process'
import {
  bestOffset,
  byLanguage,
  cueAt,
  findImdbId,
  findSubtitles,
  isCaptions,
  langName,
  parseCues,
  probeLanguage,
  releaseSubtitle,
  SUBTITLE_DEFAULTS,
  subtitleCss,
  subtitleProps,
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

// --- offset search ---------------------------------------------------------
// Five minutes of someone talking in bursts, with quiet in between. Irregular
// on purpose: evenly spaced speech fits equally well at every spacing.
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const speech: Interval[] = []
for (let at = 4; at < 290;) {
  const len = 1 + rnd() * 3
  speech.push([at, at + len])
  at += len + 0.8 + rnd() * 6
}
const silence: Interval[] = speech.map(([, end], i) => [end, speech[i + 1]?.[0] ?? 300])
silence.unshift([0, speech[0]![0]])

const shift = (by: number) => speech.map(([s, e]) => ({ start: s + by, end: e + by, text: '…' }))

const fix = bestOffset(shift(-3), silence, 0, 300)
assert.ok(Math.abs(fix.offset - 3) < 0.3, `early subtitles get pushed back, got ${fix.offset}`)
assert.ok(fix.score > 0.9 && fix.score > fix.base, 'and the fit is better than leaving them alone')
assert.ok(Math.abs(bestOffset(shift(7.5), silence, 0, 300).offset + 7.5) < 0.3, 'late subtitles get pulled forward')
assert.ok(Math.abs(bestOffset(shift(-45), silence, 0, 300).offset - 45) < 0.3, 'and a whole scene of drift still lands')

const fine = bestOffset(shift(0), silence, 0, 300)
assert.equal(fine.offset, 0)
assert.equal(fine.score, fine.base, 'nothing to gain from shifting an in-sync file')

// Dialogue repeats, so several shifts can fit equally well. The least of them
// wins: a tie is not a reason to throw the subtitles half a minute.
const metronome: Interval[] = Array.from({ length: 29 }, (_, i) => [10 + i * 10, 12 + i * 10])
const beats: Interval[] = metronome.map(([, end], i) => [end, metronome[i + 1]?.[0] ?? 300])
beats.unshift([0, 10])
const tie = bestOffset(metronome.map(([s, e]) => ({ start: s + 7.5, end: e + 7.5, text: '…' })), beats, 0, 300)
assert.ok(Math.abs(tie.offset - 2.5) < 0.3, `smallest shift wins a tie, got ${tie.offset}`)

// Nothing to work with must answer "no idea" rather than a confident zero.
assert.equal(bestOffset([], silence, 0, 300).score, 0)
assert.equal(bestOffset(shift(-3), [], 0, 10).score, 0, 'a ten second window is too short to judge')
assert.equal(bestOffset(shift(-3), [[0, 5]], 0, 300).score, 0, 'wall-to-wall sound gives no verdict')

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

  // Oppenheimer's English list leads with the hearing-impaired cut, which is
  // exactly the case the sort exists for.
  const eng = byLanguage(await findSubtitles('tt15398776')).find(l => l.name === 'English')!
  const files = await probeLanguage(eng)
  console.log('live: english versions →', files.map(f => `${f.captions ? 'SDH' : 'plain'}/${f.cues.length}`).join(' '))
  assert.equal(files[0]!.captions, false, 'plain dialogue is offered first')
}

console.log('subtitles: ok')
