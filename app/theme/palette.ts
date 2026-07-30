/**
 * A custom accent: one colour from the user, the four `primary` slots the app
 * actually paints with.
 *
 * Mixing toward black/white instead of generating a real MD3 tonal
 * palette — that needs HCT and a colour-science dependency, for four values.
 * The contrast of every pair is asserted in `scripts/check-theme.ts`.
 */

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

/**
 * `tint` pushed almost all the way to black or white, whichever direction `bg`
 * leaves room for — legible like plain black or white, but still tinted.
 */
function readable(bg: string, tint: string) {
  const [light, shade] = [mix(tint, '#ffffff', 0.88), mix(tint, '#000000', 0.88)]
  return contrast(light, bg) >= contrast(shade, bg) ? light : shade
}

/**
 * The `primary` family derived from one hex. The container moves away from
 * whichever end the accent is already at: mixing a near-black accent further
 * toward black on a dark theme collapses it into the surface behind it.
 */
export function accentColors(accent: string, dark: boolean): Record<string, string> {
  const container = dark
    ? (luminance(accent) > 0.1 ? mix(accent, '#000000', 0.62) : mix(accent, '#ffffff', 0.25))
    : (luminance(accent) < 0.55 ? mix(accent, '#ffffff', 0.82) : mix(accent, '#000000', 0.2))

  return {
    'primary': accent,
    'on-primary': readable(accent, accent),
    'primary-container': container,
    'on-primary-container': readable(container, accent),
  }
}

/** Accent shortcuts on the appearance page, so nobody has to open the picker. */
export const ACCENTS = [
  '#a8c8ff',
  '#8dcff1',
  '#8fd8a8',
  '#ffb787',
  '#ff9fb2',
  '#c7bfff',
  '#e6d67a',
  '#88c0d0',
]
