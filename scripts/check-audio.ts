import type { AudioSettings } from '../app/utils/audio'
import assert from 'node:assert'
// Self-check for the audio filters: `bun scripts/check-audio.ts`.
//
// Two things here are only ever proved by a film: what the filter *string* says
// (mpv parses it, and a chain it rejects leaves the film playing with nothing
// applied, which looks exactly like the setting doing nothing), and the two
// property names Android answers to — a seam between TypeScript and Kotlin that
// no compiler crosses.
import { readFileSync } from 'node:fs'
import { AUDIO_DEFAULTS, audioProps, MAX_DIALOGUE, mpvAudioChain, pickAudio, rememberAudio } from '../app/utils/audio'
import { exoEngine } from '../app/utils/htmlvideo'
import './i18n-stub'

// Nothing is altered unless it was asked for: a fresh install plays the mix.
assert.deepEqual(AUDIO_DEFAULTS, { normalize: 'off', dialogue: 0 })
assert.equal(mpvAudioChain(AUDIO_DEFAULTS), '', 'no filters at all, not an empty graph')
assert.equal(mpvAudioChain(AUDIO_DEFAULTS, '5.1(side)', 6), '')

// --- The leveller ---------------------------------------------------------
const light = mpvAudioChain({ normalize: 'light', dialogue: 0 })
assert.ok(light.startsWith('lavfi=[') && light.endsWith(']'), 'the graph is bracketed, or mpv eats the commas')
assert.ok(light.includes('dynaudnorm=f=500'), 'light is the long window')
assert.ok(!light.includes('s='), 'and no compressor under it')
assert.ok(mpvAudioChain({ normalize: 'strong', dialogue: 0 }).includes('s=12'), 'strong is the one with compression')

// --- Dialogue -------------------------------------------------------------
// 5.1 and up: the centre channel alone, at the layout mpv itself reported.
const surround = mpvAudioChain({ normalize: 'off', dialogue: 6 }, '5.1(side)', 6)
assert.equal(surround, 'lavfi=[pan=5.1(side)|c0=c0|c1=c1|c2=2*c2|c3=c3|c4=c4|c5=c5]')
assert.equal(
  mpvAudioChain({ normalize: 'off', dialogue: 3 }, '7.1', 8),
  'lavfi=[pan=7.1|c0=c0|c1=c1|c2=1.41*c2|c3=c3|c4=c4|c5=c5|c6=c6|c7=c7]',
  '+3 dB is a gain of √2, and only the third channel gets it',
)

// Stereo has no centre channel to lift, and neither does a layout mpv would not
// name — a `pan` naming one it hasn't got fails the whole chain.
for (const [layout, channels] of [['stereo', 2], ['', 6], ['5.1(side)', 0]] as const) {
  const chain = mpvAudioChain({ normalize: 'off', dialogue: 4 }, layout, channels)
  assert.ok(!chain.includes('pan='), `no pan for ${layout || 'an unnamed layout'}`)
  assert.ok(chain.includes('equalizer=f=2000') && chain.includes('g=4'), 'the speech band instead')
}

// Order matters: the leveller has to see the mix that will be heard.
const both = mpvAudioChain({ normalize: 'medium', dialogue: 5 }, '5.1', 6)
assert.ok(both.indexOf('pan=') < both.indexOf('dynaudnorm='), 'dialogue first, levelling second')
assert.equal(both.match(/lavfi=\[/g)?.length, 1, 'one lavfi filter holding one graph')

// The slider's ceiling is the one this was reasoned about at — a centre channel
// lifted further than this clips against the rest of the mix.
assert.ok(MAX_DIALOGUE <= 8)

// --- One film's own settings ----------------------------------------------
// The player's panel is about the film in front of you; the settings page is
// about every other one. A film with nothing of its own has to keep following
// the default, including when the default changes later.
const base: AudioSettings = { normalize: 'light', dialogue: 0 }
assert.deepEqual(pickAudio({}, 'movie:603', base), base)
assert.deepEqual(pickAudio({ 'movie:603': { normalize: 'strong', dialogue: 5 } }, 'movie:603', base), { normalize: 'strong', dialogue: 5 })
assert.deepEqual(pickAudio({ 'movie:603': { normalize: 'strong', dialogue: 5 } }, 'tv:1396', base), base, 'and the film beside it is untouched')
// A bare magnet has no title to key on and simply plays the default.
assert.deepEqual(pickAudio({ '': { normalize: 'strong', dialogue: 5 } }, '', base), base)

const one = rememberAudio({}, 'movie:603', { normalize: 'strong', dialogue: 5 }, base)
assert.deepEqual(Object.keys(one), ['movie:603'])
assert.deepEqual(rememberAudio(one, 'movie:603', { ...base }, base), {}, 'set back to the default, the film is forgotten again')
assert.deepEqual(rememberAudio(one, '', { normalize: 'off', dialogue: 0 }, base), one, 'nothing to remember a magnet against')
// The map handed in is never the map handed back, or a store's ref wouldn't see it.
assert.notEqual(one, rememberAudio(one, 'tv:1396', { normalize: 'off', dialogue: 2 }, base))

// --- The Android seam -----------------------------------------------------
const kotlin = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/java/com/ventic/app/Player.kt', import.meta.url),
  'utf8',
)

const props = audioProps({ normalize: 'strong', dialogue: 6 })
for (const name of Object.keys(props))
  assert.ok(kotlin.includes(`"${name}" ->`), `Player.kt answers ${name}`)

// Every step the settings page can produce has to mean something over there,
// or a level silently reads as "off" on the one platform that can't be typed at.
for (const level of ['light', 'medium', 'strong'])
  assert.ok(kotlin.includes(`"${level}" ->`), `and knows the ${level} step`)

// These are not mpv properties, so they only ever arrive at Kotlin by being
// forwarded verbatim by the shim. That is the whole path, tested end to end.
const seen: string[] = []
;(globalThis as any).VenticPlayer = {
  command: (json: string) => {
    seen.push(json)
    return 'null'
  },
  props: () => '{}',
  status: () => '{"running":true,"log_tail":null}',
  start: () => {},
  stop: () => {},
  codecs: () => '[]',
}
const exo = exoEngine()!
assert.ok(exo, 'a bridge means an ExoPlayer engine')
for (const [name, value] of Object.entries(props))
  exo.command(['set_property', name, value])
assert.deepEqual(seen, [
  '["set_property","audio-normalize","strong"]',
  '["set_property","dialogue-boost",6]',
], 'forwarded untouched, names and values both')

// --- The way in ------------------------------------------------------------
// The player's Audio panel edits these very settings while a film is up, and
// the only door to it is one button in the bottom bar. That button used to be
// mounted only for a file with more than one audio track — which is a minority
// of releases, and would leave the levelling unreachable exactly where it is
// wanted.
const player = readFileSync(new URL('../app/components/MpvPlayer.vue', import.meta.url), 'utf8')
assert.ok(!player.includes('audioTracks.length > 1'), 'the Audio button is not gated on a track list')
assert.ok(player.includes('LEVELLERS'), 'and the panel lists the steps from the one table')

const settings = readFileSync(new URL('../app/pages/settings/audio.vue', import.meta.url), 'utf8')
assert.ok(settings.includes('LEVELLERS'), 'as does the settings page, so the two can never disagree')

console.log('audio: ok')
