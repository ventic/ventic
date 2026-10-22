import type { ExternalVuetifyOptions } from 'vuetify-nuxt-module'
import { forVuetify as breakpoints } from './app/theme/breakpoints'
import { themes } from './app/theme/themes'

export default {
  theme: {
    // The settings page switches this at runtime and can lay a custom accent
    // over whichever is current — see app/theme/palette.ts.
    defaultTheme: 'dark',
    themes,
  },
  display: {
    thresholds: breakpoints,
    // `useDisplay().mobile` drives the sidebar overlay: below md the window is
    // too narrow to give 240px to navigation.
    mobileBreakpoint: 'md',
  },
  icons: {
    defaultSet: 'mdi-svg',
  },
  defaults: {
    VBtn: {
      color: 'primary',
      class: 'normal-case',
      rounded: 'lg',
      /**
       * A loading button builds its own VProgressCircular and passes it no
       * colour, which is Vuetify asking it to inherit — but an unqualified
       * default is a default, so the one below painted every button's spinner
       * primary. On `variant="flat" color="primary"` that is primary on
       * primary: the label reads in on-primary and the spinner that replaces
       * it all but disappears.
       *
       * `currentColor` is not a theme colour and not a CSS colour by Vuetify's
       * own test, so it resolves to a class that does not exist and the SVG's
       * `stroke: currentColor` stands — which is the label's colour, whatever
       * the variant. `undefined` would say the same thing and cannot be used:
       * vuetify-nuxt-module serialises this file, and a key whose value is
       * undefined does not survive the trip.
       */
      VProgressCircular: { color: 'currentColor' },
    },
    // Every filter in the app wants the same compact frosted control, so the
    // look lives here instead of on each usage.
    VSelect: {
      variant: 'solo-filled',
      density: 'compact',
      rounded: 'lg',
      flat: true,
      hideDetails: true,
      menuProps: { rounded: 'lg' },
    },
    VChip: {
      variant: 'tonal',
    },
    // MD3's switch: an outlined track with a small thumb that grows into the
    // filled one when it is on. The 2014 one this replaces drew "off" as a dark
    // grey bar on a dark page, which across a room read as nothing at all.
    VSwitch: {
      inset: 'material',
      color: 'primary',
    },
    // MD3's slider (Vuetify 4.3): a thick track, an upright handle with a gap
    // either side, a stop dot at the end. No `trackSize`/`thumbSize` here —
    // set inline, either one beats the sizes the variant brings.
    VSlider: {
      color: 'primary',
      density: 'compact',
      hideDetails: true,
      variant: 'pill',
    },
    // MD3's progress (4.3), as the md3 blueprint sets it: the bar and what is
    // left of the track drawn apart with a gap between them, rounded ends, and
    // a stop dot where a linear one finishes.
    VProgressCircular: {
      color: 'primary',
      indeterminate: true,
      rounded: true,
      variant: 'split',
    },
    VProgressLinear: {
      rounded: true,
      roundedBar: true,
      stopIndicator: true,
      variant: 'split',
      height: '12',
      color: 'primary',
    },
    VTooltip: {
      location: 'bottom',
    },
    VTextField: {
      color: 'primary',
      variant: 'outlined',
    },
    VTextarea: {
      color: 'primary',
      variant: 'outlined',
    },
  },
} satisfies ExternalVuetifyOptions
