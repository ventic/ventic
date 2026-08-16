// Self-check for the generated palettes: `bun scripts/check-theme.ts`.
// The point of these asserts is legibility — a derived colour pair that fails
// WCAG AA is text nobody can read, on every screen in the app at once.
import assert from 'node:assert'
import { existsSync } from 'node:fs'
import { contrast, fromHue, hueOf, luminance, mix, scheme, toRgb } from '../app/theme/palette'
import { PRESET_LIST, PRESETS } from '../app/theme/presets'
import { paintedTheme, themes } from '../app/theme/themes'
import { backdropFor } from '../app/utils/tmdb'

assert.deepEqual(toRgb('#ffffff'), [255, 255, 255])
assert.deepEqual(toRgb('fff'), [255, 255, 255], 'short form, and the hash is optional')
assert.deepEqual(toRgb('#3f5f90'), [63, 95, 144])

assert.equal(mix('#000000', '#ffffff', 0), '#000000')
assert.equal(mix('#000000', '#ffffff', 1), '#ffffff')
assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')

assert.equal(luminance('#000000'), 0)
assert.equal(luminance('#ffffff'), 1)
assert.equal(Math.round(contrast('#000000', '#ffffff')), 21)
assert.equal(contrast('#123456', '#123456'), 1)

// A half-typed hex reaches the generator on every keystroke of the picker.
for (const junk of ['', '#', '#12', 'nonsense'])
  assert.ok(scheme(junk, true).primary, `the generator survives "${junk}"`)

// The hue slider's two directions have to agree, or the thumb jumps as it moves.
for (let h = 0; h < 360; h += 15)
  assert.ok(Math.abs(hueOf(fromHue(h)) - h) <= 2, `hue ${h} came back as ${hueOf(fromHue(h))}`)

/**
 * Every `on-x` in a palette, against the `x` it is drawn on. MD3 guarantees
 * 4.5:1 for these by construction — this is what catches a hand-picked override
 * that quietly breaks the guarantee, which is the only way a shipped theme can
 * end up unreadable now.
 */
function pairs(colors: Record<string, string>) {
  const out: [string, string][] = []
  for (const key of Object.keys(colors)) {
    if (!key.includes('on-'))
      continue
    // `on-primary-fixed-variant` is drawn on `primary-fixed`; `inverse-on-surface`
    // on `inverse-surface`.
    const bg = key.replace('on-', '')
    const base = colors[bg] ? bg : colors[bg.replace(/-variant$/, '')] ? bg.replace(/-variant$/, '') : ''
    if (base)
      out.push([key, base])
  }
  return out
}

function readable(name: string, colors: Record<string, string>) {
  for (const [on, bg] of pairs(colors)) {
    assert.ok(
      contrast(colors[on]!, colors[bg]!) >= 4.5,
      `${name}: ${on} is unreadable on ${bg} (${contrast(colors[on]!, colors[bg]!).toFixed(2)}:1)`,
    )
  }
}

// Every colour anyone can pick, on both kinds of theme.
const samples = [
  '#ffffff',
  '#000000',
  '#a8c8ff',
  '#3f5f90',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#f2e14c',
  '#7a5900',
  '#88c0d0',
]

for (const source of samples) {
  for (const dark of [true, false])
    readable(`${source} on a ${dark ? 'dark' : 'light'} theme`, scheme(source, dark))
}

// One table is the whole registry: every entry has to produce a palette Vuetify
// can be handed, and a name the settings page can print on its tile.
for (const [name, preset] of PRESET_LIST) {
  assert.ok(themes[name], `${name} produced no palette`)
  assert.ok(preset.title.trim(), `${name} has no title`)
}
assert.equal(PRESET_LIST.length, Object.keys(themes).length, 'every theme is built exactly once')

// Both filters on the theme tab have to have something under them.
for (const dark of [true, false])
  assert.ok(PRESET_LIST.some(([, p]) => p.dark === dark), `no ${dark ? 'dark' : 'light'} theme to show`)

// app.vue swaps to these two by name when the palette follows the artwork —
// renaming one is a theme change that silently stops happening.
for (const name of ['generated', 'generatedLight'] as const)
  assert.ok(PRESETS[name]?.generated, `${name} must be flagged generated`)
assert.equal(PRESET_LIST.filter(([, p]) => p.generated).length, 2, 'exactly two generated palettes')

// Text on the surfaces the app actually paints, for each shipped theme.
for (const [name, theme] of Object.entries(themes)) {
  const c = theme.colors as Record<string, string>
  readable(name, c)
  for (const surface of ['background', 'surface', 'surface-container', 'surface-container-high']) {
    assert.ok(
      contrast(c['on-surface']!, c[surface]!) >= 4.5,
      `${name}: on-surface is unreadable on ${surface} (${contrast(c['on-surface']!, c[surface]!).toFixed(2)}:1)`,
    )
  }
  assert.ok(
    contrast(c.primary!, c['surface-container']!) >= 3,
    `${name}: the accent doesn't stand out against the panels it sits on (${contrast(c.primary!, c['surface-container']!).toFixed(2)}:1)`,
  )
  // Every role the app paints with exists in every theme — a missing one falls
  // back to Vuetify's own default, which belongs to no palette here.
  for (const role of ['primary', 'secondary', 'tertiary', 'error', 'success', 'warning', 'info', 'scrim', 'inverse-surface', 'primary-fixed'])
    assert.ok(c[role], `${name} has no ${role}`)
}

// --- What the palette is read off --------------------------------------------

// With "take the colour from what's on screen", the backdrop *is* the palette's
// source, so which picture wins decides the whole interface's colour.
const ART = '/art.jpg'
const MINE = 'data:image/jpeg;base64,x'

assert.equal(backdropFor('off', ART, MINE, true), undefined, 'off means off, picture or not')
assert.match(backdropFor('art', ART, MINE, false)!, /art\.jpg$/, 'poster art ignores the picture')
assert.equal(backdropFor('art', null, MINE, true), undefined, 'and shows nothing before any art')
// The point of the setting: the user's own picture is what the app rests on.
assert.equal(backdropFor('custom', ART, MINE, false), MINE, 'a browsed row never covers the picture')
assert.match(backdropFor('custom', ART, MINE, true)!, /art\.jpg$/, 'a title the user opened does')
assert.equal(backdropFor('custom', null, MINE, true), MINE, 'a title with no art falls back to it')
assert.equal(backdropFor('custom', ART, '', false), undefined, 'and no picture chosen is a flat colour')

// And which colour goes with it. The whole interface changes on this, so it may
// only change once per picture: the backdrop moves to a new title a decode
// before the new colour exists, so anything derived from the *requested*
// picture repaints the app in the outgoing one's colours on the way in.
const MOCHA = { theme: 'mocha', source: '#cba6f7', themeFromArt: true, colourFromPicture: false }
const ORANGE = '#ff8800'
const GREEN = '#00aa55'

assert.deepEqual(paintedTheme(MOCHA, { url: ART, colour: ORANGE }, MINE), { theme: 'generated', source: ORANGE })
// The flash this replaced: a colour with no picture of its own is the last
// picture's, and painting it is the film you just left colouring the one you opened.
assert.deepEqual(paintedTheme(MOCHA, { url: '', colour: GREEN }, MINE), { theme: 'mocha', source: MOCHA.source })
// A picture that decoded but wouldn't give its pixels back (no CORS) is no colour at all.
assert.deepEqual(paintedTheme(MOCHA, { url: ART, colour: '' }, MINE), { theme: 'mocha', source: MOCHA.source })
// The user's own picture is not artwork — until they say it is.
assert.deepEqual(paintedTheme(MOCHA, { url: MINE, colour: GREEN }, MINE), { theme: 'mocha', source: MOCHA.source })
assert.deepEqual(
  paintedTheme({ ...MOCHA, colourFromPicture: true }, { url: MINE, colour: GREEN }, MINE),
  { theme: 'generated', source: GREEN },
)
assert.deepEqual(paintedTheme({ ...MOCHA, themeFromArt: false }, { url: ART, colour: ORANGE }, MINE), { theme: 'mocha', source: MOCHA.source })
// A light theme keeps its light: the two generated palettes are not interchangeable.
assert.equal(paintedTheme({ ...MOCHA, theme: 'latte' }, { url: ART, colour: ORANGE }, MINE).theme, 'generatedLight')

// --- Presets -----------------------------------------------------------------

// A theme's backdrop is written straight onto the ui store when it is picked,
// so anything wrong here is silent: the theme just brings the wrong look with it.
for (const [name, { backdrop }] of PRESET_LIST) {
  if (!backdrop)
    continue
  // An image nothing is told to show is dead weight — 'custom' is the mode that
  // paints one.
  if (backdrop.image)
    assert.equal(backdrop.mode, 'custom', `${name} ships a background but doesn't switch to it`)
  // Shipped backgrounds are files in public/; a wrong path fails to load at
  // runtime and leaves a flat colour, which looks like nothing happened.
  if (backdrop.image?.startsWith('/'))
    assert.ok(existsSync(`public${backdrop.image}`), `${name}'s background is missing: public${backdrop.image}`)
  if (backdrop.tint !== undefined)
    assert.ok(backdrop.tint >= 0.2 && backdrop.tint <= 1, `${name}'s tint is outside what the slider can undo`)
  if (backdrop.blur !== undefined)
    assert.ok(backdrop.blur >= 0 && backdrop.blur <= 80, `${name}'s blur is outside what the slider can undo`)
}

console.log('check-theme: ok')
