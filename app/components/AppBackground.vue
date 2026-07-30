<script setup lang="ts">
const ui = useUiStore()

// Swap only once the new image is decoded, otherwise the crossfade shows a
// blank frame while it downloads.
const shown = ref<string>()
watch(() => ui.backdrop, url => {
  if (!url) {
    shown.value = undefined
    return
  }
  const image = new Image()
  image.onload = () => (shown.value = url)
  image.src = url
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
        class="absolute h-[130%] w-[130%] bg-cover bg-top -left-[15%] -top-[15%]"
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
