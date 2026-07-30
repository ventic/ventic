import presetWind4 from '@unocss/preset-wind4'
import { defineConfig } from 'unocss'
import { forUnoCSS as breakpoints } from './app/theme/breakpoints'

// Vuetify emits --v-theme-<name> and a matching --v-theme-on-<name> for every
// colour in the theme, so both halves of each pair are addressable here.
const themeColors = [
  'primary',
  'primary-container',
  'secondary',
  'tertiary',
  'background',
  'surface',
  'surface-light',
  'surface-dim',
  'surface-bright',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'outline',
  'outline-variant',
  'success',
  'info',
  'warning',
  'error',
  'error-container',
] as const

// Plain rgb(), no %alpha placeholder: presetWind4 applies the opacity modifier
// by wrapping the colour in color-mix(), so `border-primary/50` works from this.
const colors = Object.fromEntries(
  themeColors.flatMap(name => [
    [name, `rgb(var(--v-theme-${name}))`],
    [`on-${name}`, `rgb(var(--v-theme-on-${name}))`],
  ]),
)

/**
 * Vuetify's MD3 type scale — the same numbers as `$typography` in
 * vuetify/lib/styles/settings/_variables.scss, so a `.text-title-large` here and
 * a Vuetify component's own title are the same text.
 *
 * Shortcuts rather than rules: they compose from real utilities, so responsive
 * prefixes (`md:text-display-medium`) work, and a plain utility next to one
 * still wins — `uno-default` is a later layer than `uno-shortcuts`. That's how
 * `text-title-large font-bold` gets you a bold wordmark without a custom rule.
 *
 * Every size in the app comes from this list. If a piece of text doesn't fit
 * one of the fifteen roles, the answer is a different role, not a new size.
 */
const typography = {
  'text-display-large': 'font-heading normal-case text-[3.5625rem] font-[400] leading-[1.1228] tracking-[-.0044em]',
  'text-display-medium': 'font-heading normal-case text-[2.8125rem] font-[400] leading-[1.1556] tracking-[normal]',
  'text-display-small': 'font-heading normal-case text-[2.25rem] font-[400] leading-[1.2222] tracking-[normal]',
  'text-headline-large': 'font-heading normal-case text-[2rem] font-[400] leading-[1.25] tracking-[normal]',
  'text-headline-medium': 'font-heading normal-case text-[1.75rem] font-[400] leading-[1.2857] tracking-[normal]',
  'text-headline-small': 'font-heading normal-case text-[1.5rem] font-[400] leading-[1.3333] tracking-[normal]',
  'text-title-large': 'font-heading normal-case text-[1.375rem] font-[400] leading-[1.2727] tracking-[normal]',
  'text-title-medium': 'font-body normal-case text-[1rem] font-[500] leading-[1.5] tracking-[.0094em]',
  'text-title-small': 'font-body normal-case text-[.875rem] font-[500] leading-[1.4286] tracking-[.0071em]',
  'text-body-large': 'font-body normal-case text-[1rem] font-[400] leading-[1.5] tracking-[.0313em]',
  'text-body-medium': 'font-body normal-case text-[.875rem] font-[400] leading-[1.4286] tracking-[.0179em]',
  'text-body-small': 'font-body normal-case text-[.75rem] font-[400] leading-[1.3333] tracking-[.0333em]',
  'text-label-large': 'font-body normal-case text-[.875rem] font-[500] leading-[1.4286] tracking-[.0071em]',
  'text-label-medium': 'font-body normal-case text-[.75rem] font-[500] leading-[1.3333] tracking-[.0417em]',
  'text-label-small': 'font-body normal-case text-[.6875rem] font-[500] leading-[1.4545] tracking-[.0455em]',
}

export default defineConfig({
  /**
   * In dev the generator only knows the utilities in files Vite has already
   * transformed, so the first `uno.css` a cold server hands out is preflights
   * and safelist only — the rest arrives over an HMR round-trip the module
   * makes on load. A browser tab reloads fast enough not to notice; a Tauri
   * webview opening on the very first request renders unstyled until you
   * reload it by hand, and Android has no HMR socket at all. Scanning the
   * sources up front makes that first response the complete sheet.
   *
   * The glob is resolved against Vite's root, which Nuxt sets to `srcDir` —
   * `app/`, not the project root.
   */
  content: {
    filesystem: ['**/*.vue'],
  },
  presets: [
    presetWind4({
      // Vuetify ships its own reset; a second one fights it.
      preflights: { reset: false },
      // Vuetify scopes its themes with these instead of `.dark`.
      dark: {
        dark: '.v-theme--dark',
        light: '.v-theme--light',
      },
    }),
  ],
  outputToCssLayers: {
    cssLayerName: layer => layer === 'properties' ? null : `uno-${layer}`,
  },
  shortcuts: {
    ...typography,
    /**
     * Clear whatever the OS has taken off the top and bottom edges — Android's
     * status bar and gesture pill (see --safe-* in assets/css/layers.css). Zero
     * on desktop and on a TV, so it goes on the shared layout rather than behind
     * a breakpoint.
     *
     * Top and bottom only: this lands on `v-main` in two of the layouts, and
     * Vuetify drives *that* element's left padding from the permanent drawer's
     * width — a `pl-` here sits in a later layer and would collapse it.
     */
    'safe-inset': 'pt-[var(--safe-top)] pb-[var(--safe-bottom)]',
  },
  theme: {
    breakpoint: breakpoints,
    colors,
    // Vuetify's own $body-font-family/$heading-font-family already read these
    // vars, so app/assets/css/layers.css is the single place a font is named.
    font: {
      heading: 'var(--v-font-heading)',
      body: 'var(--v-font-body)',
    },
  },
  // Vuetify's `rounded` and `color` props build these class names at runtime, so
  // no source file spells them out for UnoCSS to find by scanning.
  // Unlike Vuetify's bg-*, wind4's sets only the background and not the paired
  // on-* foreground, so anything on a coloured surface states its text-on-* class.
  safelist: [
    'rounded',
    'rounded-lg',
    'rounded-xl',
    ...['primary', 'success', 'warning', 'info', 'error'].flatMap(c => [`bg-${c}`, `text-${c}`]),
  ],
})
