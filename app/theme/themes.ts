import type { ThemeDefinition, ThemeInstance } from 'vuetify'
import { accentColors, mix } from './palette'

/**
 * Every palette the app ships. Vuetify gets them all at boot (they're static)
 * and the settings page only switches which one is current — themes can't be
 * added at runtime without re-rendering the stylesheet, and there is no reason
 * to: a custom accent is applied on top of whichever one is picked (see
 * `applyAccent` in ./palette).
 */

const dark: ThemeDefinition = {
  colors: {
    'background': '#1e2023',
    'surface': '#121317',
    'surface-dim': '#121317',
    'surface-bright': '#38393d',
    'surface-container-lowest': '#0c0e11',
    'surface-container-low': '#1a1c1f',
    'surface-container': '#1e2023',
    'surface-container-high': '#282a2d',
    'surface-container-highest': '#333538',
    'on-surface': '#e2e2e6',
    'outline': '#8e909a',
    'outline-variant': '#43474f',
    'primary': '#a8c8ff',
    'on-primary': '#06305e',
    'primary-container': '#254776',
    'on-primary-container': '#d5e3ff',
    'secondary': '#8dcff1',
    'on-secondary': '#003548',
    'secondary-container': '#004d66',
    'on-secondary-container': '#c0e8ff',
    'tertiary': '#c7bfff',
    'on-tertiary': '#2f295e',
    'tertiary-container': '#464076',
    'on-tertiary-container': '#e5deff',
    'error': '#ffb4ab',
    'on-error': '#690005',
    'error-container': '#93000a',
    'on-error-container': '#ffb4ab',
    'surface-light': '#38393d',
  },
  dark: true,
  variables: {
    'overlay-background': '#181c23',
  },
}

const light: ThemeDefinition = {
  colors: {
    'background': '#eeedf2',
    'surface': '#f9f9fd',
    'surface-dim': '#dadade',
    'surface-bright': '#f9f9fd',
    'surface-container-lowest': '#ffffff',
    'surface-container-low': '#f3f3f8',
    'surface-container': '#eeedf2',
    'surface-container-high': '#e8e8ec',
    'surface-container-highest': '#e2e2e6',
    'on-surface': '#1a1c1f',
    'outline': '#747780',
    'outline-variant': '#c4c6d0',
    'primary': '#3f5f90',
    'on-primary': '#ffffff',
    'primary-container': '#d5e3ff',
    'on-primary-container': '#001b3c',
    'error': '#ba1a1a',
    'on-error': '#ffffff',
    'error-container': '#ffdad6',
    'on-error-container': '#410002',
    'surface-light': '#e8e8ec',
  },
  dark: false,
  variables: {
    'overlay-background': '#181c23',
  },
}

/**
 * The nine surface slots Material wants, plus the text on them, walked out of
 * one colour: every step mixes the surface toward white on a dark theme and
 * toward black on a light one. The two palettes above are the hand-tuned
 * reference this is shaped to match.
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
    'outline': step(0.55),
    'outline-variant': step(0.24),
  }
}

/**
 * A palette from two colours — the surface everything sits on and the accent
 * painted over it. Error colours, the overlay and the secondary/tertiary pairs
 * come from the base theme, because nothing in the app draws with them.
 */
function make(isDark: boolean, surface: string, accent: string, extra?: Record<string, string>): ThemeDefinition {
  const base = isDark ? dark : light
  return {
    ...base,
    colors: { ...base.colors, ...ramp(surface, isDark), ...accentColors(accent, isDark), ...extra },
  }
}

/* --- Dark --------------------------------------------------------------- */

/** True black for OLED panels, where "dark grey" still glows in a dark room. */
const midnight = make(true, '#000000', '#9fd8ff', { background: '#000000' })
const carbon = make(true, '#161616', '#78a9ff')
const mono = make(true, '#17171a', '#d6d6dd')
const nord = make(true, '#272c36', '#88c0d0')
const tokyo = make(true, '#1a1b26', '#7aa2f7')
// Catppuccin ships its own surfaces (crust → surface2), and they're tinted blue,
// not grey — the generated ramp mixes toward white and washes that out.
const mocha = make(true, '#181825', '#cba6f7', {
  'background': '#1e1e2e',
  'surface-dim': '#181825',
  'surface-bright': '#45475a',
  'surface-container-lowest': '#11111b',
  'surface-container-low': '#1e1e2e',
  'surface-container': '#1e1e2e',
  'surface-container-high': '#313244',
  'surface-container-highest': '#45475a',
  'surface-light': '#45475a',
  'on-surface': '#cdd6f4',
  'outline': '#6c7086',
  'outline-variant': '#45475a',
  'error': '#f38ba8',
  'on-error': '#1e1e2e',
  'error-container': '#585b70',
  'on-error-container': '#f38ba8',
})
const dracula = make(true, '#282a36', '#bd93f9')
const rosepine = make(true, '#191724', '#ebbcba')
const gruvbox = make(true, '#282828', '#fabd2f')
const monokai = make(true, '#272822', '#a6e22e')
const solarizedDark = make(true, '#002b36', '#2aa198')
const ember = make(true, '#141110', '#ffb787')
const forest = make(true, '#0e1512', '#8fd8a8')
const abyss = make(true, '#0b1a2b', '#58c4ff')
const crimson = make(true, '#1a1012', '#ff9aa2')
const amethyst = make(true, '#1b1526', '#cfa8ff')

/* --- Light -------------------------------------------------------------- */

const paper = make(false, '#fdf8f1', '#7a5900')
const latte = make(false, '#eff1f5', '#1b57cf')
const solarizedLight = make(false, '#fdf6e3', '#0f6a9c')
const gruvboxLight = make(false, '#fbf1c7', '#af3a03')
const frost = make(false, '#eceff4', '#41618c')
const mint = make(false, '#eef4f0', '#0c6b4f')
const blossom = make(false, '#fdf0f4', '#b4326a')
const lavender = make(false, '#f3f0fa', '#6b4fbb')

export const themes = {
  dark,
  midnight,
  carbon,
  mono,
  nord,
  tokyo,
  mocha,
  dracula,
  rosepine,
  gruvbox,
  monokai,
  solarizedDark,
  ember,
  forest,
  abyss,
  crimson,
  amethyst,
  light,
  paper,
  latte,
  solarizedLight,
  gruvboxLight,
  frost,
  mint,
  blossom,
  lavender,
}

export type ThemeName = keyof typeof themes

/**
 * What the settings page lists, in the order it lists them. Dark or light is
 *  read off the definition, so the two groups can never disagree with it.
 */
export const THEMES: { value: ThemeName, title: string }[] = [
  { value: 'dark', title: 'Ventic Dark' },
  { value: 'midnight', title: 'Midnight (OLED)' },
  { value: 'carbon', title: 'Carbon' },
  { value: 'mono', title: 'Monochrome' },
  { value: 'nord', title: 'Nord' },
  { value: 'tokyo', title: 'Tokyo Night' },
  { value: 'mocha', title: 'Mocha' },
  { value: 'dracula', title: 'Dracula' },
  { value: 'rosepine', title: 'Rosé Pine' },
  { value: 'gruvbox', title: 'Gruvbox' },
  { value: 'monokai', title: 'Monokai' },
  { value: 'solarizedDark', title: 'Solarized Dark' },
  { value: 'ember', title: 'Ember' },
  { value: 'forest', title: 'Forest' },
  { value: 'abyss', title: 'Abyss' },
  { value: 'crimson', title: 'Crimson' },
  { value: 'amethyst', title: 'Amethyst' },
  { value: 'light', title: 'Ventic Light' },
  { value: 'paper', title: 'Paper' },
  { value: 'latte', title: 'Latte' },
  { value: 'solarizedLight', title: 'Solarized Light' },
  { value: 'gruvboxLight', title: 'Gruvbox Light' },
  { value: 'frost', title: 'Frost' },
  { value: 'mint', title: 'Mint' },
  { value: 'blossom', title: 'Blossom' },
  { value: 'lavender', title: 'Lavender' },
]

/**
 * Point Vuetify at a theme, with the accent (if any) laid over it. The theme's
 * own colours are re-applied from the definition every time, so clearing the
 * accent puts the palette back rather than leaving the last custom one behind.
 */
export function applyTheme(theme: ThemeInstance, name: string, accent: string) {
  const key = (name in themes ? name : 'dark') as ThemeName
  const target = theme.themes.value[key]
  if (target) {
    Object.assign(target.colors, themes[key].colors, accent ? accentColors(accent, !!themes[key].dark) : {})
  }
  theme.change(key)
}
