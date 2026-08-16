<script setup lang="ts">
import { sourceFromImage } from '~/theme/palette'

const ui = useUiStore()
const settings = useSettingsStore()

// Swap only once the new image is decoded, otherwise the crossfade shows a
// blank frame while it downloads.
const shown = ref<string>()
// The decoded picture itself, kept so the palette can be read straight off it,
// with the backdrop it came from — the colour is only ever published together
// with the picture it belongs to (see `paintedTheme`).
const loaded = shallowRef<{ url: string, image: HTMLImageElement }>()

/**
 * Asking for the pixels back means asking for them CORS-clean, and it has to
 * happen on the *first* request for that URL: the browser stores the response
 * against the mode it was fetched with, and a later anonymous request is
 * refused against a plain cached entry rather than re-fetching it. So the
 * preload carries `crossOrigin` whenever the palette is following the art —
 * which is also why flipping that setting re-runs this.
 *
 * A host that doesn't allow it keeps its background: the load is retried
 * without, and only the colour is lost.
 */
watch([() => ui.backdrop, () => settings.themeFromArt], ([url, cors]) => {
  if (!url) {
    shown.value = undefined
    loaded.value = undefined
    return
  }
  const load = (anonymous: boolean, bust = false) => {
    // A picture already cached from a plain request is refused outright, so the
    // retry asks under a URL that has no entry yet. TMDB ignores the parameter,
    // and from then on the CORS-clean copy is the cached one.
    const src = bust ? `${url}${url.includes('?') ? '&' : '?'}cors=1` : url
    const image = new Image()
    if (anonymous)
      image.crossOrigin = 'anonymous'
    image.onload = () => {
      // A slow decode can land after the art has moved on; the newer one wins.
      if (ui.backdrop !== url)
        return
      shown.value = src
      loaded.value = { url, image }
    }
    image.onerror = () => anonymous && (bust ? load(false) : load(true, true))
    image.src = src
  }
  load(!!cors)
}, { immediate: true })

// The palette that follows the art, read off the picture already on screen —
// no second request, and nothing to taint the canvas. It lands here rather than
// on the backdrop changing, which is what keeps the palette a step behind the
// art instead of a step ahead of it: nothing is repainted until the picture the
// colour came from is the picture being shown.
//
// The source is dropped only when there is nothing to read it off any more, not
// merely because this component has no decoded picture *yet*: changing layout
// remounts it, and clearing in between drops the whole interface back to the
// plain theme for the frame it takes to decode the same picture from cache.
watch([loaded, () => settings.themeFromArt], ([art, on]) => {
  if (on && art)
    ui.shownArt = { url: art.url, colour: sourceFromImage(art.image) ?? '' }
  else if (!on || !ui.backdrop)
    ui.shownArt = { url: '', colour: '' }
}, { immediate: true })
</script>

<template>
  <div class="fixed inset-0 z-0 overflow-hidden bg-background" aria-hidden="true">
    <transition
      enter-active-class="transition-opacity duration-900 ease-out"
      leave-active-class="transition-opacity duration-900 ease-out"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <!-- Oversized so the blur doesn't fade out at the window edges.
           brightness() is what keeps a white poster art (there are plenty) from
           turning the whole window into light grey under a dark-theme text
           colour; the tint alone can't do it without hiding the art entirely. -->
      <div
        v-if="shown"
        :key="shown"
        class="ventic-backdrop absolute h-[130%] w-[130%] bg-cover bg-top -left-[15%] -top-[15%]"
        :style="{ backgroundImage: `url(${shown})`, filter: `blur(${ui.blur}px) brightness(0.5) saturate(1.25)` }"
      />
    </transition>

    <!-- Two gradients instead of one flat fill: vertical for text legibility
         (heaviest at the bottom, under the content), horizontal to keep the
         window edges dark so the frosted chrome reads against it. -->
    <div
      class="absolute inset-0 bg-gradient-to-b from-background/50 via-background/72 to-background"
      :style="{ opacity: ui.tint }"
    />
    <div class="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background opacity-45" />
  </div>
</template>
