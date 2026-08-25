import type { ThemeDefinition, ThemeInstance } from 'vuetify'
import type { Preset, ThemeName } from './presets'
import { mix, scheme } from './palette'
import { PRESETS } from './presets'

/**
 * What turns the table in ./presets into Vuetify palettes. Each theme is a full
 * MD3 token set generated from its accent (see ./palette) with the colours that
 * make it recognisable — usually its surfaces — laid back on top. So a theme is
 * defined by the two or three colours it is actually *about*, and the forty-odd
 * roles nothing hand-picks still exist and still contrast properly.
 *
 * Vuetify gets them all at boot (they're static) and the settings page only
 * switches which one is current — themes can't be added at runtime without
 * re-rendering the stylesheet, which is why the generated palette is two
 * placeholder entries whose colours are recomputed in `applyTheme` instead.
 */

/**
 * A palette from one source colour and nothing else — Material Theme Builder's
 * output, surfaces included. This is what the user's own colour produces.
 */
function generate(source: string, isDark: boolean): ThemeDefinition {
  return {
    dark: isDark,
    colors: scheme(source, isDark),
    variables: { 'overlay-background': '#181c23' },
  }
}

/**
 * The nine surface slots Material wants, plus the text on them, walked out of
 * one colour: every step mixes the surface toward white on a dark theme and
 * toward black on a light one. This is what keeps a theme's own grey (Nord's
 * blue-grey, Gruvbox's brown) instead of the neutral the generator derives from
 * the accent. Everything else — containers, fixed, inverse — is generated.
 */
function ramp(surface: string, isDark: boolean) {
  const out = isDark ? '#ffffff' : '#000000'
  const step = (amount: number) => mix(surface, out, amount)
  return {
    surface,
    'background': step(0.06),
    'surface-dim': isDark ? surface : step(0.14),
    'surface-bright': isDark ? step(0.17) : surface,
    // The lowest slot is the only one that moves the other way on a dark theme.
    'surface-container-lowest': isDark ? mix(surface, '#000000', 0.25) : '#ffffff',
    'surface-container-low': step(0.04),
    'surface-container': step(0.06),
    'surface-container-high': step(0.1),
    'surface-container-highest': step(0.15),
    'surface-light': step(isDark ? 0.17 : 0.07),
    'on-surface': step(0.9),
    'on-background': step(0.9),
    'outline': step(0.55),
    'outline-variant': step(0.24),
  }
}

/** One entry of the table as a Vuetify theme. */
export function build(p: Preset): ThemeDefinition {
  const base = generate(p.accent, p.dark)
  if (!p.surface)
    return base
  return { ...base, colors: { ...base.colors, ...ramp(p.surface, p.dark), ...p.colors } }
}

export const themes = Object.fromEntries(
  Object.entries(PRESETS).map(([name, preset]) => [name, build(preset)]),
) as Record<ThemeName, ThemeDefinition>

/**
 * The colour every layer under the app paints while it has nothing to paint
 * yet: the native window, the webview, and `html` before a stylesheet lands.
 *
 * It is the default theme's own ground, so a cold start is the app arriving
 * rather than a flash of somebody else's white — see `ground` in nuxt.config.
 * Three of the places that need it can't import it (tauri.conf.json,
 * res/values/colors.xml, and the boot script's fallback), so `bun run
 * check:boot` asserts all four still say the same thing.
 */
// Asserted as a string rather than proved as one: Vuetify types a palette slot
// as anything a CSS colour can be, while `ramp` above only ever puts a hex there.
// `bun run check:boot` holds it to that, and to matching the three files that
// can't import it.
export const GROUND = themes.dark.colors!.background as string

/** True for the entries whose palette is computed rather than written down. */
export function isGenerated(name: string) {
  return !!PRESETS[name as ThemeName]?.generated
}

/**
 * Which theme to paint and what to generate it from. Both halves come out of
 * the *painted* picture — one url and the colour read off that url — never out
 * of `ui.backdrop`, which names the next picture the moment a title is opened
 * and so runs a decode ahead of its colour. Reading the two separately paints
 * the incoming title in the outgoing picture's colours until it loads, which is
 * one theme change too many and reads as a flash.
 */
export function paintedTheme(
  s: { theme: string, source: string, themeFromArt: boolean, colourFromPicture: boolean },
  art: { url: string, colour: string },
  ownPicture: string,
) {
  // A picture the user chose is only "what's on screen" if they say so — the
  // usual case is a background picked to go with a theme, which has no business
  // recolouring it. Artwork still moves the palette either way.
  const following = s.themeFromArt && !!art.colour
    && ((!!art.url && art.url !== ownPicture) || s.colourFromPicture)
  return {
    theme: following
      ? (PRESETS[s.theme as ThemeName]?.dark === false ? 'generatedLight' : 'generated')
      : s.theme,
    source: following ? art.colour : s.source,
  }
}

/**
 * Point Vuetify at a theme. Every colour is re-applied from the definition (or
 * regenerated from the source colour) every time, so the generated entries
 * follow the source colour rather than keeping whatever was registered at boot.
 */
export function applyTheme(theme: ThemeInstance, s: { theme: string, source: string }) {
  const key = (s.theme in themes ? s.theme : 'dark') as ThemeName
  const target = theme.themes.value[key]
  if (target)
    Object.assign(target.colors, isGenerated(key) ? scheme(s.source, !!PRESETS[key].dark) : themes[key].colors)
  theme.change(key)
}
