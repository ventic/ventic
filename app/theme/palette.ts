/**
 * Material Design 3 palettes: every colour the app paints with, walked out of
 * one source colour.
 *
 * The generator is Google's own (`@material/material-color-utilities`, the
 * package behind Material Theme Builder) rather than ours. MD3 tones live in
 * HCT, and the point of paying for that dependency is that the contrast of
 * every `on-x` pair falls out of the spec instead of being hand-tuned — which
 * is what makes a colour the *user* picked safe to paint the whole app with.
 * `scripts/check-theme.ts` asserts it anyway.
 */

import {
  argbFromRgb,
  customColor,
  DynamicColor,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
  sourceColorFromImageBytes,
} from '@material/material-color-utilities'

type RGB = [number, number, number]

export function toRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h
  return [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16) || 0) as RGB
}

function toHex(rgb: RGB) {
  return `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

/** `amount` of `b` blended into `a`, 0–1. */
export function mix(a: string, b: string, amount: number) {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex(x.map((v, i) => v + (y[i]! - v) * amount) as RGB)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as RGB
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** Never throws on a half-typed hex — the picker writes as the user types. */
function hct(hex: string) {
  return Hct.fromInt(argbFromRgb(...toRgb(hex)))
}

/** The hue of a colour, 0–360, and back — what the hue slider moves along. */
export function hueOf(hex: string) {
  return Math.round(hct(hex).hue)
}

export function fromHue(hue: number) {
  // Fixed chroma and tone: only tonalSpot's *hue* survives into the palette
  // anyway, and a source of constant vividness makes the slider predictable.
  return hexFromArgb(Hct.from(hue, 60, 60).toInt())
}

/**
 * The colour to build a palette from, read off a picture — Material Theme
 * Builder's "from image" flow, using the same quantiser.
 *
 * Sampled through a 64px canvas rather than at full size. The library's own
 * `sourceColorFromImage` quantises every pixel of the source, which for a
 * 1280x720 backdrop is 900k of them and long enough to drop frames on a
 * television; 4k pixels score the same colour.
 *
 * Null rather than a throw for every failure, because the caller's answer is
 * always the same — keep the palette that's already up.
 */
export function sourceFromImage(image: CanvasImageSource): string | null {
  try {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      return null
    context.drawImage(image, 0, 0, size, size)
    // Throws if the picture was loaded without CORS — see AppBackground, which
    // is what arranges for it not to be.
    return hexFromArgb(sourceColorFromImageBytes(context.getImageData(0, 0, size, size).data))
  }
  catch {
    return null
  }
}

/**
 * Roles Material has no opinion about but Vuetify paints with (`v-alert`'s
 * types, `text-warning`). Blended toward the source colour, so an alert belongs
 * to the theme instead of arriving from Vuetify's defaults in primary green.
 */
const EXTRA_ROLES = {
  success: '#4caf50',
  warning: '#fb8c00',
  info: '#2196f3',
}

/**
 * Every MD3 token for one source colour, keyed the way Vuetify wants them
 * (`onPrimaryContainer` → `on-primary-container`). Read off the library's own
 * list rather than spelled out here: a token added upstream then arrives on its
 * own, and one renamed can't silently keep its old value.
 */
export function scheme(source: string, dark: boolean): Record<string, string> {
  // `tonalSpot` is Material's default and what Android itself uses.
  const s = new SchemeTonalSpot(hct(source), dark, 0)

  const out: Record<string, string> = {}
  for (const [name, colour] of Object.entries(MaterialDynamicColors)) {
    // The palette key colours are the generator's own scaffolding, not roles.
    if (colour instanceof DynamicColor && !name.endsWith('PaletteKeyColor'))
      out[name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)] = hexFromArgb(colour.getArgb(s))
  }
  // Vuetify's own name for the brightest surface; MD3 calls it surface-bright.
  out['surface-light'] = out['surface-bright']!

  for (const [name, design] of Object.entries(EXTRA_ROLES)) {
    const group = customColor(s.sourceColorHct.toInt(), {
      name,
      value: argbFromRgb(...toRgb(design)),
      blend: true,
    })[dark ? 'dark' : 'light']
    Object.assign(out, {
      [name]: hexFromArgb(group.color),
      [`on-${name}`]: hexFromArgb(group.onColor),
      [`${name}-container`]: hexFromArgb(group.colorContainer),
      [`on-${name}-container`]: hexFromArgb(group.onColorContainer),
    })
  }
  return out
}
