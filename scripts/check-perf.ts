// Self-check for what keeps the app drawable on a television:
// `bun scripts/check-perf.ts`.
//
// None of this is logic with a return value to assert on — it is CSS, and the
// only thing that catches a regression is measuring frames on a real TV, which
// no test can do. What it *can* do is hold the shape of the fix in place, since
// every rule here was reverted one at a time on the test set and the frame rate
// measured, and every one of them is a line another change would remove without
// noticing: an effect looks free on the laptop it was written on.
//
// Measured on a Philips TPM191E (1.5GHz quad A53, 1080p), release build, home
// page loaded to 278 cards — none of this / always-on half / switch as well:
//
//   scrolling the page      16.1 → 36.0 → 39.4 fps
//   ten d-pad moves          3.1 → 13.1 → 22.8 fps
//
// The always-on half is the bigger win and costs nothing to look at. The switch
// is worth having anyway: it nearly doubles what a remote feels like, because
// moving focus is what fires the transitions and scrolling largely doesn't.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const card = read('app/components/MediaCard.vue')
const layers = read('app/assets/css/layers.css')
const background = read('app/components/AppBackground.vue')
const settings = read('app/stores/settings.ts')
const appearance = read('app/components/settings/Appearance.vue')
const app = read('app/app.vue')

// --- Always on, no setting: these cost nothing to look at ---

// Worth 2x on its own — the browse pages mount hundreds of cards and without it
// a TV paints every one of them, on screen or not.
assert.match(
  card,
  /\[content-visibility:auto\]/,
  'MediaCard must skip rendering off-screen cards (content-visibility)',
)
assert.match(
  card,
  /containIntrinsicSize/,
  'content-visibility needs a size to reserve, or the scrollbar jumps as cards are drawn',
)

// One frame-buffer readback per card, twenty on screen at once. Comments are
// stripped first — the one above the badge says the word to explain its absence.
assert.doesNotMatch(
  card.replace(/<!--[\s\S]*?-->|\/\/[^\n]*/g, ''),
  /backdrop-blur/,
  'no backdrop-filter on a card: it is per-card GPU work for an effect too small to see',
)

// The blurred art never moves, but it sits behind a scrolling page — without its
// own compositor layer the blur is redone every frame.
assert.match(background, /ventic-backdrop/, 'the backdrop art needs the class the CSS promotes')
assert.match(
  layers,
  /\.ventic-backdrop\s*\{[^}]*will-change:\s*transform/,
  'the backdrop art must be promoted to its own layer so its blur is cached',
)

// --- Behind the switch ---

for (const [what, re] of [
  ['transitions', /html\.reduce-effects \*[\s\S]{0,200}?transition:\s*none\s*!important/],
  ['the frosted chrome', /html\.reduce-effects[\s\S]{0,400}?backdrop-filter:\s*none/],
  ['the backdrop blur', /html\.reduce-effects \.ventic-backdrop\s*\{[^}]*filter:/],
] as const)
  assert.match(layers, re, `reduce-effects must drop ${what}`)

// A frozen spinner reads as a hung app, and the skeletons are the only other
// animation here — so the switch deliberately leaves `animation` alone. Costs
// nothing either: measured, the frame rate came back from transitions, not these.
assert.doesNotMatch(
  layers,
  /html\.reduce-effects[\s\S]{0,200}?animation:\s*none/,
  'reduce-effects must not stop animations — the loading spinners are animations',
)

// The blur goes, the brightness and saturation stay: they are what stops white
// poster art washing the text out, which is a legibility bug, not a slow frame.
assert.match(
  layers,
  /html\.reduce-effects \.ventic-backdrop\s*\{[^}]*brightness\([^)]*\)[^}]*saturate\(/,
  'dropping the backdrop blur must keep its brightness/saturation',
)

// --- Wiring: a setting nothing reads is a setting that does nothing ---

assert.match(settings, /reduceEffects = useLocalStorage\('ventic\.reduceEffects'/, 'the setting is stored')
assert.match(settings, /'ventic\.reduceEffects', isTv\(\) \?\? false/, 'a television gets it on by default')
assert.match(settings, /return \{[^}]*reduceEffects/, 'the store must expose it')
assert.match(
  app,
  /classList\.toggle\('reduce-effects', settings\.reduceEffects\)/,
  'the setting must put the class on <html>, which is what the CSS keys off',
)
assert.match(appearance, /v-model="settings\.reduceEffects"/, 'Appearance needs the switch')

// eslint-disable-next-line no-console
console.log('check-perf: ok')
process.exit(0)
