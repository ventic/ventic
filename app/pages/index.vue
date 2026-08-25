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

/**
 * The five at the top. Backdrop art is the whole point of the panel, so a title
 * without one is passed over rather than shown as a grey box.
 */
const spotlight = computed(() => (trending.value ?? []).filter(m => m.backdrop).slice(0, 5))

const at = ref(0)
const featured = computed(() => spotlight.value[Math.min(at.value, spotlight.value.length - 1)])

// The panel carries its own art; this is the window behind it, blurred down to
// a wash — `ambient` rather than `select` so it never covers a picture the user
// set themselves.
watch(featured, media => media && ui.ambient(media), { immediate: true })

// ponytail: no auto-advance. It moves the thing under a remote's focus ring,
// and it is a `useIntervalFn` plus a pause-on-focus rule away if it's missed.

const rows = computed(() => [
  { title: $t('Popular movies'), request: { path: '/movie/popular', type: 'movie' as const } },
  { title: $t('Popular shows'), request: { path: '/tv/popular', type: 'tv' as const } },
])

// Enough room for a poster row so v-lazy doesn't collapse before it mounts.
const rowHeight = computed(() => Math.round(ui.cardWidth * 1.5) + 92)
</script>

<template>
  <div class="h-full overflow-y-auto pb-10">
    <!-- The panel is its own picture rather than a hole onto the app backdrop:
         that one is off entirely in two of the three backdrop modes, and a hero
         with nothing behind it is worse than no hero. -->
    <section class="relative mx-4 mt-2 h-[42vh] min-h-64 overflow-hidden rounded-2xl md:mx-6 md:h-[46vh]">
      <transition
        enter-active-class="transition-opacity duration-500"
        leave-active-class="transition-opacity duration-500"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div v-if="featured" :key="featured.id" class="absolute inset-0">
          <media-poster :src="backdropUrl(featured.backdrop, 'w1280')" :alt="featured.title" />
        </div>
      </transition>

      <!-- White text on somebody else's photograph: the copy needs its own
           darkness under it, in both directions, whatever the theme is doing. -->
      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />

      <div v-if="featured" class="relative h-full flex flex-col justify-end gap-2 p-4 text-white md:p-6">
        <div class="flex items-center gap-2">
          <v-chip size="small" :prepend-icon="mdiStar" class="font-medium">
            {{ featured.rating.toFixed(1) }}
          </v-chip>
          <span class="text-label-medium uppercase opacity-80">
            {{ featured.type === 'movie' ? $t('Movie') : $t('TV Show') }} · {{ featured.year || $t('unknown') }}
          </span>
        </div>

        <h1 class="max-w-3xl text-headline-medium font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] md:text-display-small">
          {{ featured.title }}
        </h1>

        <p class="line-clamp-2 max-w-2xl text-body-medium opacity-85">
          {{ featured.overview }}
        </p>

        <!-- gap-y: on a phone the posters wrap under the buttons, and a bare
             gap-2 leaves them touching. -->
        <div class="flex flex-wrap items-end gap-x-2 gap-y-3 pt-1">
          <v-btn :prepend-icon="mdiPlay" size="large" :to="library.resumeLink(featured)">
            {{ $t('Play') }}
          </v-btn>
          <v-btn :prepend-icon="mdiInformationOutline" size="large" variant="tonal" :to="mediaLink(featured)">
            {{ $t('Details') }}
          </v-btn>
          <v-btn icon variant="text" color="white" size="large" @click="library.toggleWatchlist(featured)">
            <v-icon :icon="library.inWatchlist(featured) ? mdiBookmark : mdiBookmarkOutline" :color="library.inWatchlist(featured) ? 'primary' : undefined" />
            <v-tooltip activator="parent" :text="library.inWatchlist(featured) ? $t('Remove from watchlist') : $t('Add to watchlist')" />
          </v-btn>
          <v-btn icon variant="text" color="white" size="large" @click="library.toggleFavourite(featured)">
            <v-icon :icon="library.isFavourite(featured) ? mdiHeart : mdiHeartOutline" :color="library.isFavourite(featured) ? 'primary' : undefined" />
            <v-tooltip activator="parent" :text="library.isFavourite(featured) ? $t('Remove from favourites') : $t('Favourite')" />
          </v-btn>

          <v-spacer />

          <!-- Posters, not dots: they say which title you are switching to, and
               they are a real target for a thumb and for a remote. Buttons, so
               the d-pad reaches them from Play along the same row. -->
          <div class="flex gap-2">
            <button
              v-for="(media, index) in spotlight"
              :key="media.id"
              type="button"
              class="h-15 w-10 shrink-0 overflow-hidden rounded-lg outline-none ring-2 ring-white/25 transition-all md:h-18 md:w-12 hover:ring-white focus-visible:ring-white"
              :class="index === at ? 'ring-primary opacity-100' : 'opacity-60'"
              :aria-label="media.title"
              :aria-current="index === at"
              @click="at = index"
              @focus="at = index"
            >
              <media-poster :src="posterUrl(media.poster, 'w185')" :alt="media.title" />
            </button>
          </div>
        </div>
      </div>

      <div v-else class="relative h-full flex flex-col justify-end gap-3 p-4 md:p-6">
        <div class="animate-pulse h-10 max-w-md w-2/3 rounded-lg bg-surface-container/60" />
        <div class="animate-pulse h-12 max-w-2xl w-full rounded-lg bg-surface-container/60" />
      </div>
    </section>

    <div class="flex flex-col gap-7 pt-7">
      <!-- To the thing itself, not straight into playback: an episode you are
           about to start deserves the page that says what it is, with Play on
           it. A film's card already goes to its own page, which is the same
           answer. Not lazy — it comes out of localStorage, and it's the first
           thing you should see. -->
      <scroll-row v-if="library.resumeRow.length" :title="$t('Continue watching')">
        <media-card
          v-for="entry in library.resumeRow"
          :key="entry.key"
          :media="entry.media"
          :to="entry.season ? episodeLink(entry.media.id, entry.season, entry.episode) : undefined"
          :detail="ui.isDetailed"
          class="shrink-0"
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
