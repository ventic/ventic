// Self-check for the custom-accent palette: `bun scripts/check-theme.ts`.
// The point of these asserts is legibility — a derived colour pair that fails
// WCAG AA is text nobody can read, on every screen in the app at once.
import assert from 'node:assert'
import { accentColors, contrast, luminance, mix, toRgb } from '../app/theme/palette'
import { THEMES, themes } from '../app/theme/themes'

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

// Every accent anyone can pick, on both kinds of theme: the text drawn on the
// accent and on its container has to stay readable. 4.5 is WCAG AA for body
// text; the app draws labels at that size on buttons and chips.
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

for (const accent of samples) {
  for (const dark of [true, false]) {
    const c = accentColors(accent, dark)
    const where = `${accent} on a ${dark ? 'dark' : 'light'} theme`
    assert.equal(c.primary, accent, `the accent is used as-is: ${where}`)
    assert.ok(
      contrast(c['on-primary']!, accent) >= 4.5,
      `on-primary is unreadable for ${where} (${contrast(c['on-primary']!, accent).toFixed(2)}:1)`,
    )
    assert.ok(
      contrast(c['on-primary-container']!, c['primary-container']!) >= 4.5,
      `on-primary-container is unreadable for ${where} (${contrast(c['on-primary-container']!, c['primary-container']!).toFixed(2)}:1)`,
    )
  }
}

// The settings page lists themes by name; a typo there is a blank swatch and a
// theme that can never be selected.
for (const { value, title } of THEMES) {
  assert.ok(themes[value], `THEMES lists "${value}", which is not a theme`)
  assert.ok(title.trim(), `${value} has no title`)
}
assert.equal(THEMES.length, Object.keys(themes).length, 'every theme is listed exactly once')

// Text on the surfaces the app actually paints, for each shipped theme.
for (const [name, theme] of Object.entries(themes)) {
  const c = theme.colors as Record<string, string>
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
  // Buttons and chips draw a label on the accent — including the themes whose
  // palette is generated rather than hand-picked.
  for (const [on, bg] of [['on-primary', 'primary'], ['on-primary-container', 'primary-container']]) {
    assert.ok(
      contrast(c[on!]!, c[bg!]!) >= 4.5,
      `${name}: ${on} is unreadable on ${bg} (${contrast(c[on!]!, c[bg!]!).toFixed(2)}:1)`,
    )
  }
}

console.log('check-theme: ok')
