<script setup lang="ts">
import { applyTheme, paintedTheme } from '~/theme/themes'

// The settings page only writes preferences; this is where the two global ones
// take effect. It sits in app.vue rather than a plugin because `useTheme()`
// needs the Vuetify app context.
const settings = useSettingsStore()
const ui = useUiStore()
const theme = useTheme()

/**
 * What to actually paint. Following the art reuses the two generated palettes
 * rather than adding a third — Vuetify sizes its stylesheet from the themes it
 * was built with — so it is the same swap the colour picker makes, with the
 * source coming off the screen instead of a slider. The user's own theme choice
 * is left alone underneath, and comes back when the setting goes off.
 */
const painted = computed(() => paintedTheme(settings, ui.shownArt, ui.backdropImage))

watch(painted, value => applyTheme(theme, value), { immediate: true })

// Whether the webview is one of the engines that implements `zoom` itself
// rather than the standard property — see the shim further down for what that
// costs, and `--frame-zoom` right here for the other half of it.
const legacyZoom = !('currentCSSZoom' in Element.prototype)

// Vuetify and UnoCSS both size in px, so the single knob that grows all of it
// at once is the root's zoom — the same thing a browser's Ctrl+= does. Menus
// and dialogs teleport to <body>, so scaling anything lower would miss them.
//
// A child frame is the one thing the root's zoom gets wrong on WebKit: it lays
// the frame's document out in the zoomed page's device pixels and then scales
// it again, so a YouTube embed comes out `uiScale` too big and the card clips
// the right of it. Undoing the zoom on the frame is the only compensation that
// leaves the box where it was — a transform scales the box down with the
// content, and widening the box overflows the card instead of the frame.
watchEffect(() => {
  document.documentElement.style.zoom = String(settings.uiScale)
  document.documentElement.style.setProperty('--frame-zoom', String(legacyZoom ? 1 / settings.uiScale : 1))
})

// One class, one block of CSS (assets/css/layers.css) — cheaper than teaching
// every component that draws a blur or a transition about the setting, and it
// reaches Vuetify's own styles, which no prop of ours would.
watchEffect(() => {
  document.documentElement.classList.toggle('reduce-effects', settings.reduceEffects)
})

// WebKit — the webview on Linux, our main target — implements `zoom` itself but
// not the `Element.currentCSSZoom` accessor Vuetify reads it back with, so its
// overlay positioning silently skips the zoom correction and every tooltip and
// menu opens misplaced (it only looks right from the second open, because the
// strategy re-measures against the offsets it wrote last time). Feature
// detected, so Chromium and Firefox keep their own.
function effectiveZoom(el: Element | null): number {
  return el ? (Number.parseFloat(getComputedStyle(el).zoom) || 1) * effectiveZoom(el.parentElement) : 1
}

if (legacyZoom) {
  Object.defineProperty(Element.prototype, 'currentCSSZoom', {
    get(this: Element) {
      return effectiveZoom(this)
    },
  })
}

// One check a launch, for the badge in the toolbar. Deliberately not awaited and
// never fatal: it is a GitHub request, and being offline is the ordinary case.
useUpdatesStore().check()

// Unlayered, so a user rule beats both Vuetify's components and UnoCSS —
// otherwise "advanced" would mean "fight the cascade" (see assets/css/layers.css).
useStyleTag(computed(() => settings.customCss), { id: 'ventic-custom-css' })
</script>

<template>
  <nuxt-layout>
    <nuxt-page />
  </nuxt-layout>
</template>
