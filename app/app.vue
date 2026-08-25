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

watch(painted, value => {
  applyTheme(theme, value)
  // Every layer under the page — the native window, the webview, and `html`
  // before a stylesheet lands — follows the colour the app is actually painted,
  // so nothing flashes somebody else's white on the way in. See utils/ground.
  rememberGround(theme.current.value.colors.background)
}, { immediate: true })

/**
 * The other global preference that only takes effect here: the UI language.
 *
 * @nuxtjs/i18n owns the live locale, the store only remembers the choice — its
 * own memory would be a cookie, and a cookie on a `tauri://` origin is not
 * reliably kept. The URL carries no language (`strategy: 'no_prefix'`), so this
 * is the only thing that decides which one the app opens in: restore it once at
 * boot, then follow whatever the settings page switches to.
 */
// `useNuxtApp().$i18n` rather than `useI18n()`: the same composer, but typed
// flat as `Composer` instead of re-inferring vue-i18n's message-schema generics
// over all 72 locale codes, which alone costs more than TypeScript's
// instantiation budget for the whole app.
const { locale, setLocale, locales } = useNuxtApp().$i18n

if (settings.locale && settings.locale !== locale.value)
  setLocale(settings.locale as typeof locale.value)

watch(locale, code => (settings.locale = code), { immediate: true })

/**
 * `<html lang>` and, for Arabic/Farsi/Hebrew/Urdu, `<html dir="rtl">`.
 *
 * The `dir` is what flips the whole layout, and vuetify-nuxt-module reads the
 * same `dir` off the locale list to flip Vuetify's own components (see
 * `createAdapter` in its i18n plugin). The `lang` is the full tag — `sl-SI`,
 * not `sl` — which is what `uiLocale()` reads back to format dates and money.
 *
 * Set by hand rather than through `useLocaleHead`, which is really an SEO tag
 * generator: it also writes canonical and hreflang links, and warns on every
 * render about the `baseUrl` it would need for them. This app is a bundle
 * behind a Tauri webview — it has no canonical URL and nothing to be indexed
 * by, so these two attributes are the whole of what it wants.
 */
const current = computed(() => locales.value.find(l => l.code === locale.value))

useHead({
  htmlAttrs: {
    lang: computed(() => current.value?.language ?? locale.value),
    dir: computed(() => current.value?.dir ?? 'ltr'),
  },
})

// Vuetify and UnoCSS both size in px, so the single knob that grows all of it
// at once is a zoom on the whole page. There are two of those and they are not
// equivalent, so the device picks.
//
// The webview's own zoom is the same thing Ctrl+= is, applied a level below the
// document: one coordinate system, so layout, `getBoundingClientRect`,
// transforms, child frames and `devicePixelRatio` all still agree with each
// other. CSS `zoom` is the fallback and it is the only thing in CSS that splits
// them — a rect comes back zoomed while `offsetWidth` and the px inside a
// `transform` do not — so anything that measures one and writes the other lands
// somewhere wrong and needs a compensation of its own: Vuetify's overlays (the
// shim below), Vuetify's tab slider, a YouTube embed (`--frame-zoom`). Prefer
// the real one wherever there is one.
//
// wry has no zoom on Android (its backend takes the factor and drops it) and a
// browser has no webview to ask, so those two keep CSS `zoom` and everything
// that props it up.
const nativeZoom = isDesktop()

// Whether the webview is one of the engines that implements CSS `zoom` itself
// rather than the standard property — only interesting on the fallback path.
const legacyZoom = !nativeZoom && !('currentCSSZoom' in Element.prototype)

watchEffect(() => {
  if (nativeZoom) {
    // Not persisted by any of the three webviews, so it is reapplied every launch.
    // Deliberately not falling back to CSS `zoom` when it fails: half of one
    // scheme and half of the other is worse than a scale that visibly does
    // nothing, and the only way it fails is a build missing the capability.
    useTauriWebviewWindowGetCurrentWebviewWindow()
      .setZoom(settings.uiScale)
      .catch(e => console.warn('app scale: the webview refused a zoom', e))
    return
  }
  document.documentElement.style.zoom = String(settings.uiScale)
  document.documentElement.style.setProperty('--frame-zoom', String(legacyZoom ? 1 / settings.uiScale : 1))
})

// One class, one block of CSS (assets/css/layers.css) — cheaper than teaching
// every component that draws a blur or a transition about the setting, and it
// reaches Vuetify's own styles, which no prop of ours would.
watchEffect(() => {
  document.documentElement.classList.toggle('reduce-effects', settings.reduceEffects)
})

// An engine on the fallback path may implement `zoom` itself but not the
// `Element.currentCSSZoom` accessor Vuetify reads it back with, and then its
// overlay positioning silently skips the zoom correction and every tooltip and
// menu opens misplaced (it only looks right from the second open, because the
// strategy re-measures against the offsets it wrote last time). Feature
// detected, so an engine with the accessor keeps its own.
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
