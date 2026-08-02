/**
 * Every look the app ships, one entry each. This is the only file to touch to
 * add, remove or reorder a theme: the Vuetify palettes, the settings page's
 * grid and the order it lists them in are all derived from this table (see
 * ./themes), so an entry here is a theme everywhere.
 *
 * A theme is a *preset*, not only a palette — picking one lays down the whole
 * look it was drawn for, background included. Everything it names is written
 * into the settings as if the user had set it there, and is then theirs to
 * move; nothing re-applies it later, so a preset can't quietly undo a slider on
 * the next reload. What a theme leaves out it leaves alone, which is what keeps
 * a picture the user chose themselves from being wiped by a change of colour.
 */

/** Poster art, one picture, or nothing at all. Also `BackdropMode` in stores/ui. */
export type BackdropMode = 'art' | 'custom' | 'off'

/**
 * What a theme sets behind the app. Every key is optional and every one is a
 *  `ui` store setting; naming none means the background is left as it is.
 */
export interface Backdrop {
  mode?: BackdropMode
  /**
   * A picture the app ships (`public/backgrounds/…`), in the same slot as one
   * the user chose.
   * ponytail: one key for both, so a theme with a background replaces a picture
   * they uploaded. Split the two if anyone misses theirs.
   */
  image?: string
  /** 0–80, matching the slider. */
  blur?: number
  /** 0.2–1, matching the slider. */
  tint?: number
}

export interface Preset {
  /** What the settings page calls it. */
  title: string
  dark: boolean
  /**
   * The one colour the palette is generated from — Material's own generator
   * works out the other forty-odd roles (see ./palette).
   */
  accent: string
  /**
   * The theme's own grey, which the nine surface slots are walked out of. This
   * is what keeps Nord's blue-grey or Gruvbox's brown instead of the neutral
   * the generator derives from the accent. Left out, the generator's is used.
   */
  surface?: string
  /** Roles the generator gets wrong for this theme, laid back over the result. */
  colors?: Record<string, string>
  /** The look it was drawn for. */
  backdrop?: Backdrop
  /**
   * Recomputed from the user's own colour at runtime rather than fixed. Two
   * such entries exist because Vuetify sizes its stylesheet from the themes it
   * was built with and can't be handed a new one later.
   */
  generated?: true
}

/** The colour the "Your colour" themes start from — the logo's red. */
export const DEFAULT_SOURCE = '#ff5555'

export const PRESETS = {
  /* --- Dark ---------------------------------------------------------------- */

  generated: {
    title: 'Your colour',
    dark: true,
    accent: DEFAULT_SOURCE,
    generated: true,
  },

  /**
   * The logo is the brief: a grey disc, white, and one red. The ground is a warm
   * near-black carrying that red rather than the blue-violet neutral a generator
   * derives on its own — it is what `AppBackground` lays over every blurred
   * poster, so the surface hue grades every screen in the app.
   *
   * `#ff5555` is tone 60 at chroma 80, and Material puts a dark theme's primary
   * at tone 80 — where sRGB has only chroma 31 left for red. Left alone the brand
   * colour comes back as `#ffb3ae`, a pale salmon. So primary is pinned to the
   * logo's own red, which the two contrast bars both allow at tone 60: 5.25:1
   * against the panels it sits on, and 5.46:1 for the dark red drawn on top of
   * it. What made an earlier attempt at this need an exemption was painting pure
   * white on the red — that pair is 3.14:1, and nothing here asks for it.
   *
   * The red also lands dimmer than the pale blue it replaces (5.25:1 where that
   * was 10.9:1), which is the point: in a dark room the chrome belongs under the
   * poster art rather than above it.
   */
  dark: {
    title: 'Ventic Dark',
    dark: true,
    surface: '#141011',
    accent: '#ff5555',
    colors: {
      'primary': '#ff5555',
      'on-primary': '#3d0508',
      'primary-container': '#a60e1e',
      'on-primary-container': '#ffdad7',
      'surface-tint': '#ff5555',
      // Generated from the red, these come back as further reds; a cool tertiary
      // keeps the palette from being one hue and is what the backdrop wash reads
      // against.
      'tertiary': '#5cdcb6',
      'on-tertiary': '#00382a',
      'tertiary-container': '#00513e',
      'on-tertiary-container': '#7ff8d1',
    },
    backdrop: { mode: 'custom', image: '/backgrounds/ventic-dark.svg' },
  },

  /** True black for OLED panels, where "dark grey" still glows in a dark room. */
  midnight: {
    title: 'Midnight (OLED)',
    dark: true,
    surface: '#000000',
    accent: '#9fd8ff',
    colors: { background: '#000000' },
  },

  carbon: { title: 'Carbon', dark: true, surface: '#161616', accent: '#78a9ff' },
  mono: { title: 'Monochrome', dark: true, surface: '#17171a', accent: '#d6d6dd' },
  nord: { title: 'Nord', dark: true, surface: '#272c36', accent: '#88c0d0' },
  tokyo: { title: 'Tokyo Night', dark: true, surface: '#1a1b26', accent: '#7aa2f7' },

  // Catppuccin ships its own surfaces (crust → surface2), and they're tinted blue,
  // not grey — the generated ramp mixes toward white and washes that out.
  mocha: {
    title: 'Mocha',
    dark: true,
    surface: '#181825',
    accent: '#cba6f7',
    colors: {
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
      // Catppuccin's own error container (surface2 behind the same pink) is 2.9:1
      // and unreadable — the generated one stays.
    },
  },

  dracula: { title: 'Dracula', dark: true, surface: '#282a36', accent: '#bd93f9' },
  rosepine: { title: 'Rosé Pine', dark: true, surface: '#191724', accent: '#ebbcba' },
  gruvbox: { title: 'Gruvbox', dark: true, surface: '#282828', accent: '#fabd2f' },
  monokai: { title: 'Monokai', dark: true, surface: '#272822', accent: '#a6e22e' },
  solarizedDark: { title: 'Solarized Dark', dark: true, surface: '#002b36', accent: '#2aa198' },
  ember: { title: 'Ember', dark: true, surface: '#141110', accent: '#ffb787' },
  forest: { title: 'Forest', dark: true, surface: '#0e1512', accent: '#8fd8a8' },
  abyss: { title: 'Abyss', dark: true, surface: '#0b1a2b', accent: '#58c4ff' },
  crimson: { title: 'Crimson', dark: true, surface: '#1a1012', accent: '#ff9aa2' },
  amethyst: { title: 'Amethyst', dark: true, surface: '#1b1526', accent: '#cfa8ff' },

  /* --- Light --------------------------------------------------------------- */

  generatedLight: {
    title: 'Your colour',
    dark: false,
    accent: DEFAULT_SOURCE,
    generated: true,
  },

  // Ventic Dark upside down. The red drops to tone 45 because `#ff5555` on white
  // is 3.1:1 — too pale to carry white text or to read as a link. The logo red
  // survives as `inverse-primary`, which is only ever drawn on something dark.
  light: {
    title: 'Ventic Light',
    dark: false,
    surface: '#fdf8f8',
    accent: '#c92d33',
    colors: {
      'primary': '#c92d33',
      'on-primary': '#ffffff',
      'primary-container': '#ffdad7',
      'on-primary-container': '#410005',
      'inverse-primary': '#ff5555',
      'surface-tint': '#c92d33',
      'error': '#ba1a1a',
      'on-error': '#ffffff',
      'error-container': '#ffdad6',
      'on-error-container': '#410002',
    },
    backdrop: { mode: 'custom', image: '/backgrounds/ventic-light.svg' },
  },

  paper: { title: 'Paper', dark: false, surface: '#fdf8f1', accent: '#7a5900' },
  latte: { title: 'Latte', dark: false, surface: '#eff1f5', accent: '#1b57cf' },
  solarizedLight: { title: 'Solarized Light', dark: false, surface: '#fdf6e3', accent: '#0f6a9c' },
  gruvboxLight: { title: 'Gruvbox Light', dark: false, surface: '#fbf1c7', accent: '#af3a03' },
  frost: { title: 'Frost', dark: false, surface: '#eceff4', accent: '#41618c' },
  mint: { title: 'Mint', dark: false, surface: '#eef4f0', accent: '#0c6b4f' },
  blossom: { title: 'Blossom', dark: false, surface: '#fdf0f4', accent: '#b4326a' },
  lavender: { title: 'Lavender', dark: false, surface: '#f3f0fa', accent: '#6b4fbb' },
} as const satisfies Record<string, Preset>

export type ThemeName = keyof typeof PRESETS

/** The table as a plain list, in the order the settings page shows them. */
export const PRESET_LIST = Object.entries(PRESETS) as [ThemeName, Preset][]
