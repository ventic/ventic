<script setup lang="ts">
import type { Media } from '~/utils/tmdb'
import { mdiBookmark, mdiBookmarkOutline, mdiCheck, mdiDotsVertical, mdiEye, mdiEyeOutline, mdiHeart, mdiHeartOutline, mdiPlay, mdiStar } from '@mdi/js'

const props = defineProps<{ media: Media }>()

const ui = useUiStore()
const library = useLibraryStore()

// A show's is measured in episodes, a film's in the file — see `watchBar`.
// No room for the label a card draws beside it; the bar alone is the point here.
const bar = computed(() => library.cardBar(props.media))
const watched = computed(() => library.isWatched(props.media))

// Same reason as MediaCard: the action buttons only exist while hovered, so a
// 200-row list isn't 600 Vuetify components. Focus counts as hover, so a remote
// sees the same row it would with a pointer.
const hover = ref(false)
</script>

<template>
  <nuxt-link
    :to="mediaLink(media)"
    class="group flex select-none items-center gap-3 rounded-xl px-3 py-2 outline-none transition-colors odd:bg-surface-container/30 hover:bg-surface-container-high/70 focus-visible:ring-2 focus-visible:ring-primary"
    @mouseenter="hover = true; ui.preview(media)"
    @mouseleave="hover = false"
    @focus="hover = true; ui.hover(media)"
    @blur="hover = false"
  >
    <div class="relative aspect-2/3 w-14 shrink-0 overflow-hidden rounded-md">
      <media-poster :src="posterUrl(media.poster, 'w154')" :alt="media.title" />
      <div v-if="hover" class="grid place-items-center absolute inset-0 bg-black/55">
        <v-icon :icon="mdiPlay" size="20" class="text-white" />
      </div>
      <div v-if="bar" class="absolute inset-x-0 bottom-0 h-1 bg-black/60">
        <div class="h-full bg-primary" :style="{ width: `${bar.fraction * 100}%` }" />
      </div>
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <v-icon v-if="watched" :icon="mdiCheck" size="16" color="primary" :title="$t('Watched')" />
        <span class="truncate text-title-small">{{ media.title }}</span>
        <span class="shrink-0 text-body-small opacity-55">{{ media.year || $t('unknown') }}</span>
        <span v-if="media.rating" class="flex shrink-0 items-center gap-0.5 text-body-small opacity-80">
          <svg viewBox="0 0 24 24" class="size-3 fill-amber-400"><path :d="mdiStar" /></svg>
          {{ media.rating.toFixed(1) }}
        </span>
      </div>
      <div class="line-clamp-2 pt-0.5 text-body-small opacity-65">
        {{ media.overview || $t('No overview.') }}
      </div>
    </div>

    <!-- Fixed width so mounting the buttons on hover doesn't reflow the title.
         tabindex="-1": the row is the d-pad target, these are pointer extras. -->
    <div class="flex w-36 shrink-0 justify-end">
      <template v-if="hover">
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" @click.stop.prevent="library.toggleFavourite(media)">
          <v-icon :icon="library.isFavourite(media) ? mdiHeart : mdiHeartOutline" size="18" :color="library.isFavourite(media) ? 'primary' : undefined" />
        </v-btn>
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" @click.stop.prevent="library.toggleWatchlist(media)">
          <v-icon :icon="library.inWatchlist(media) ? mdiBookmark : mdiBookmarkOutline" size="18" :color="library.inWatchlist(media) ? 'primary' : undefined" />
        </v-btn>
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" @click.stop.prevent="library.toggleWatched(media)">
          <v-icon :icon="watched ? mdiEye : mdiEyeOutline" size="18" :color="watched ? 'primary' : undefined" />
        </v-btn>
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" @click.stop.prevent>
          <v-icon :icon="mdiDotsVertical" size="18" />
        </v-btn>
      </template>
    </div>
  </nuxt-link>
</template>
