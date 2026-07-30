import type { DisplayThresholds } from 'vuetify'

// Vuetify's default breakpoints, pulled out so UnoCSS can share them.
// presetWind4 otherwise ships Tailwind's (sm 640 / md 768 / lg 1024), which
// would fire `md:`/`lg:` at different widths than `<v-col md lg>` reflows at.
// Keep in sync with $grid-breakpoints in app/assets/css/settings.scss.
const breakpoints: DisplayThresholds = {
  xs: 0,
  sm: 600,
  md: 960,
  lg: 1280,
  xl: 1920,
  xxl: 2560,
}

export const forVuetify = breakpoints

export const forUnoCSS = Object.fromEntries(
  Object.entries(breakpoints).map(([key, value]) => [key, `${value}px`]),
) as Record<keyof DisplayThresholds, string>
