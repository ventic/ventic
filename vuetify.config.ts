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
    VSlider: {
      color: 'primary',
      density: 'compact',
      hideDetails: true,
      trackSize: 3,
      thumbSize: 14,
    },
    VProgressCircular: {
      color: 'primary',
      indeterminate: true,
    },
    VProgressLinear: {
      rounded: true,
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
