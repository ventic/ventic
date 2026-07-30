<script setup lang="ts">
import { applyTheme } from '~/theme/themes'

// The settings page only writes preferences; this is where the two global ones
// take effect. It sits in app.vue rather than a plugin because `useTheme()`
// needs the Vuetify app context.
const settings = useSettingsStore()
const theme = useTheme()

watch(
  [() => settings.theme, () => settings.accent],
  ([name, accent]) => applyTheme(theme, name, accent),
  { immediate: true },
)

// Vuetify and UnoCSS both size in px, so the single knob that grows all of it
// at once is the root's zoom — the same thing a browser's Ctrl+= does. Menus
// and dialogs teleport to <body>, so scaling anything lower would miss them.
watchEffect(() => {
  document.documentElement.style.zoom = String(settings.uiScale)
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

if (!('currentCSSZoom' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'currentCSSZoom', {
    get(this: Element) {
      return effectiveZoom(this)
    },
  })
}

// Unlayered, so a user rule beats both Vuetify's components and UnoCSS —
// otherwise "advanced" would mean "fight the cascade" (see assets/css/layers.css).
useStyleTag(computed(() => settings.customCss), { id: 'ventic-custom-css' })

// Pull down whatever was watched on another device, once a session and only if
// the last pull has gone stale. Not awaited and never blocking: with no Trakt
// connected it returns immediately, and with one it's a background correction
// to rows that have already rendered.
useTraktStore().sync()
</script>

<template>
  <nuxt-layout>
    <nuxt-page />
  </nuxt-layout>
</template>
