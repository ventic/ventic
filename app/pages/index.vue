<script setup lang="ts">
import type { TmdbPage } from '~/utils/tmdb'
import { mdiBookmark, mdiBookmarkOutline, mdiHeart, mdiHeartOutline, mdiInformationOutline, mdiPlay, mdiStar } from '@mdi/js'

const ui = useUiStore()
const library = useLibraryStore()

const { data: trending } = useAsyncData(
  'home-trending',
  () => tmdb<TmdbPage>('/trending/all/day'),
  { lazy: true, transform: page => page.results.flatMap(item => toMedia(item) ?? []) },
)

// The page has no art of its own — the app backdrop is the art, and hovering
// any card below swaps both it and this panel.
const featured = computed(() => ui.selected ?? trending.value?.[0])

watchEffect(() => {
  if (!ui.selected && trending.value?.[0])
    ui.select(trending.value[0])
})

const rows = [
  { title: 'Trending today', request: { path: '/trending/all/day' } },
  { title: 'Popular movies', request: { path: '/movie/popular', type: 'movie' as const } },
  { title: 'Popular shows', request: { path: '/tv/popular', type: 'tv' as const } },
  { title: 'Top rated movies', request: { path: '/movie/top_rated', type: 'movie' as const } },
  { title: 'Top rated shows', request: { path: '/tv/top_rated', type: 'tv' as const } },
  { title: 'In cinemas', request: { path: '/movie/now_playing', type: 'movie' as const } },
]

// Enough room for a poster row so v-lazy doesn't collapse before it mounts.
const rowHeight = computed(() => Math.round(ui.cardWidth * 1.5) + 92)
</script>

<template>
  <div class="h-full overflow-y-auto pb-10">
    <section class="flex min-h-[34vh] flex-col justify-end gap-3 px-4 pb-10 pt-6 md:min-h-[44vh] md:px-6">
      <template v-if="featured">
        <div class="flex items-center gap-2">
          <v-chip size="small" :prepend-icon="mdiStar" class="font-medium">
            {{ featured.rating.toFixed(1) }}
          </v-chip>
          <span class="text-label-medium uppercase opacity-70">
            {{ featured.type === 'movie' ? 'Movie' : 'TV Show' }} · {{ featured.year || 'unknown' }}
          </span>
        </div>

        <h1 class="max-w-3xl text-headline-large font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] md:text-display-medium">
          {{ featured.title }}
        </h1>

        <p class="line-clamp-3 max-w-2xl text-body-medium opacity-80 md:text-body-large">
          {{ featured.overview }}
        </p>

        <div class="flex flex-wrap items-center gap-2 pt-1">
          <v-btn :prepend-icon="mdiPlay" size="large" :to="library.resumeLink(featured)">
            Play
          </v-btn>
          <v-btn :prepend-icon="mdiInformationOutline" size="large" variant="tonal" :to="mediaLink(featured)">
            Details
          </v-btn>
          <v-btn icon variant="text" color="on-surface" size="large" @click="library.toggleWatchlist(featured)">
            <v-icon :icon="library.inWatchlist(featured) ? mdiBookmark : mdiBookmarkOutline" :color="library.inWatchlist(featured) ? 'primary' : undefined" />
            <v-tooltip activator="parent" :text="library.inWatchlist(featured) ? 'Remove from watchlist' : 'Add to watchlist'" />
          </v-btn>
          <v-btn v-if="library.canFavourite(featured)" icon variant="text" color="on-surface" size="large" @click="library.toggleFavourite(featured)">
            <v-icon :icon="library.isFavourite(featured) ? mdiHeart : mdiHeartOutline" :color="library.isFavourite(featured) ? 'primary' : undefined" />
            <v-tooltip activator="parent" :text="library.isFavourite(featured) ? 'Remove from favourites' : 'Favourite'" />
          </v-btn>
        </div>
      </template>

      <div v-else class="flex flex-col gap-3">
        <div class="animate-pulse h-6 w-32 rounded-lg bg-surface-container/60" />
        <div class="animate-pulse h-12 w-2/3 max-w-md rounded-lg bg-surface-container/60" />
        <div class="animate-pulse h-16 w-full max-w-2xl rounded-lg bg-surface-container/60" />
      </div>
    </section>

    <div class="flex flex-col gap-7">
      <!-- Straight back into playback, not to the detail page: this row exists
           to save you the two clicks. Not lazy — it comes out of localStorage,
           and it's the first thing you should see. -->
      <scroll-row v-if="library.resumeRow.length" title="Continue watching">
        <media-card
          v-for="entry in library.resumeRow"
          :key="entry.key"
          :media="entry.media"
          :to="watchLink(entry.media.type, entry.media.id, entry.season, entry.episode)"
          :detail="ui.isDetailed"
          class="shrink-0 snap-start"
          :style="{ width: `${ui.cardWidth}px` }"
        />
      </scroll-row>

      <!-- Only the rows in view fetch their page; the rest wait until scrolled to. -->
      <v-lazy
        v-for="row in rows"
        :key="row.title"
        :min-height="rowHeight"
        transition="fade-transition"
      >
        <media-slider :title="row.title" :request="row.request" />
      </v-lazy>
    </div>
  </div>
</template>
