<script setup lang="ts">
import { mdiImageOffOutline } from '@mdi/js'

// Plain <img loading="lazy"> instead of <v-img>: the grid renders hundreds of
// these and v-img adds an intersection observer plus a transition per instance,
// which is what made switching layouts stutter. The browser does it for free.
defineProps<{
  /** Already-sized TMDB url, or null for the placeholder. */
  src?: string | null
  alt?: string
  /** Fills its parent, which owns the aspect ratio and rounding. */
  icon?: string
  /**
   * Fit the whole picture inside the frame instead of filling it. For a channel
   * logo, which is any shape at all — cropping one cuts a broadcaster's name in
   * half. The padding is on the image so the placeholder keeps the same ground.
   */
  contain?: boolean
}>()
</script>

<template>
  <div class="relative size-full overflow-hidden bg-surface-container-high">
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      loading="lazy"
      decoding="async"
      draggable="false"
      class="size-full"
      :class="contain ? 'object-contain p-3' : 'object-cover'"
    >
    <div v-else class="grid size-full place-items-center bg-gradient-to-br from-surface-container-high to-surface-container-lowest">
      <v-icon :icon="icon ?? mdiImageOffOutline" size="28" class="opacity-25" />
    </div>
  </div>
</template>
