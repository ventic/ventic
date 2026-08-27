<script setup lang="ts">
import type { MediaType } from '~/utils/tmdb'
import { mdiAlertCircleOutline, mdiBookmark, mdiBookmarkOutline, mdiEye, mdiEyeOutline, mdiHeart, mdiHeartOutline, mdiOpenInNew, mdiPlay, mdiStar, mdiYoutube } from '@mdi/js'

// Keeps /foo/123 out of here; anything else 404s instead of asking TMDB.
definePageMeta({
  validate: ({ params }) => 'type' in params && (params.type === 'movie' || params.type === 'tv'),
})

const route = useRoute()
const ui = useUiStore()
const library = useLibraryStore()
const { mobile } = useDisplay()

const type = computed(() => route.params.type as MediaType)
const id = computed(() => String(route.params.id))

const { data: media, status, error } = useMediaDetail(type, id)

// This page's art is the app backdrop, for exactly as long as the page is up.
let mine = 0
watch(media, value => value && (mine = ui.select(value)), { immediate: true })
onUnmounted(() => ui.release(mine))

const meta = computed(() => {
  const m = media.value
  if (!m)
    return []
  return [
    m.year,
    m.type === 'movie'
      ? runtimeText(m.runtime)
      : m.episodeCount
        ? $t('{seasons} seasons · {episodes} episodes', { seasons: m.seasons.length, episodes: m.episodeCount })
        : '',
    m.status,
    m.companies.join(', '),
  ].filter(Boolean)
})

const credits = computed(() => {
  const m = media.value
  if (!m)
    return []
  return [
    { label: m.directors.length > 1 ? $t('Directors') : $t('Director'), value: m.directors.join(', ') },
    { label: m.writers.length > 1 ? $t('Writers') : $t('Writer'), value: m.writers.slice(0, 3).join(', ') },
    { label: $t('Budget'), value: moneyText(m.budget) },
    { label: $t('Revenue'), value: moneyText(m.revenue) },
  ].filter(row => row.value)
})

const trailer = ref(false)

// Escape hatch: YouTube refuses to embed some titles, and the dialog just shows
// its "unavailable" card. Opens in the OS browser under Tauri, a tab under `bun dev`.
async function openTrailer() {
  const url = `https://www.youtube.com/watch?v=${media.value?.trailer}`
  try {
    await useTauriShellOpen(url)
  }
  catch {
    window.open(url, '_blank')
  }
}

// A show has no single thing to play, so the button names (and starts) whatever
// comes next: the episode left part-way through, the one after the last one
// finished, or the very first if the show is new to you (and if it's finished,
// the very first again — there is nowhere else to go).
const firstSeason = computed(() => media.value?.seasons[0]?.number ?? 0)

const target = computed(() => {
  if (type.value !== 'tv' || !media.value)
    return null
  return nextEpisode(media.value.seasons, library.lastEpisode(id.value))
    ?? (firstSeason.value ? { season: firstSeason.value, episode: 1 } : null)
})

/** "S2 E4" — also what tells the template a show has anything playable at all. */
const targetText = computed(() => target.value ? `S${target.value.season} E${target.value.episode}` : '')

const playLink = computed(() =>
  target.value
    ? watchLink('tv', id.value, target.value.season, target.value.episode)
    : watchLink('movie', id.value),
)

// Part-way through is a resume; anything else is a play, including the next
// episode of a show you're in the middle of.
const started = computed(() => {
  const p = media.value && (target.value
    ? library.episodeProgress(id.value, target.value.season, target.value.episode)
    : library.cardProgress(media.value))
  return p && !p.watched && resumable(p.position, p.duration) ? p : null
})

const playLabel = computed(() => [
  started.value ? $t('Resume') : $t('Play'),
  targetText.value,
  remainingText(started.value) && `· ${remainingText(started.value)}`,
].filter(Boolean).join(' '))
</script>

<template>
  <div class="h-full overflow-y-auto pb-12">
    <div v-if="error" class="flex h-full flex-col items-center justify-center gap-2">
      <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
      <span class="text-body-medium opacity-70">{{ $t('Couldn\'t load this title.') }}</span>
      <v-btn variant="tonal" :to="localePath('/')">
        {{ $t('Go home') }}
      </v-btn>
    </div>

    <template v-else>
      <section class="px-4 pb-8 pt-4 md:px-6">
        <div class="flex flex-col gap-6 sm:flex-row sm:items-end">
          <div class="aspect-2/3 w-32 shrink-0 overflow-hidden rounded-2xl shadow-2xl sm:w-44 lg:w-52">
            <media-poster :src="posterUrl(media?.poster, 'w500')" :alt="media?.title" />
          </div>

          <div v-if="media" class="flex min-w-0 flex-1 flex-col gap-3">
            <!-- max-w-full: a wordmark is a wide image, and `max-w-md` alone is
                 wider than a phone — the title ran off the side of the screen. -->
            <img
              v-if="media.logo"
              :src="logoUrl(media.logo)!"
              :alt="media.title"
              class="max-h-16 max-w-full self-start object-contain drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] sm:max-h-24 sm:max-w-md"
            >
            <h1 v-else class="text-headline-large font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
              {{ media.title }}
            </h1>

            <p v-if="media.tagline" class="text-body-medium italic opacity-60">
              {{ media.tagline }}
            </p>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small opacity-75">
              <span class="flex items-center gap-1 opacity-100">
                <v-icon :icon="mdiStar" size="14" class="text-amber-400" />
                <span class="font-medium">{{ media.rating.toFixed(1) }}</span>
                <span class="opacity-60">({{ media.votes.toLocaleString(uiLocale()) }})</span>
              </span>
              <span v-if="media.certification" class="rounded border border-outline-variant px-1.5 py-0.5 text-label-small">
                {{ media.certification }}
              </span>
              <span v-for="part in meta" :key="part">{{ part }}</span>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <v-chip v-for="genre in media.genres" :key="genre.id" size="small" :text="genre.name" />
            </div>

            <p class="max-w-3xl text-body-medium opacity-85">
              {{ media.overview || $t('No overview.') }}
            </p>

            <dl v-if="credits.length" class="grid grid-cols-1 gap-x-6 gap-y-1 text-body-small sm:grid-cols-2 lg:max-w-2xl">
              <div v-for="row in credits" :key="row.label" class="flex gap-2">
                <dt class="shrink-0 opacity-50">
                  {{ row.label }}
                </dt>
                <dd class="truncate opacity-85">
                  {{ row.value }}
                </dd>
              </div>
            </dl>

            <!-- Six controls at `large` came to three ragged rows on a phone.
                 Play takes its own full-width row there — it is what the page is
                 for — and the rest fall in behind it at the normal size. -->
            <div class="flex flex-wrap items-center gap-2 pt-2">
              <v-btn
                v-if="type === 'movie' || target"
                :prepend-icon="mdiPlay"
                :size="mobile ? 'default' : 'large'"
                :block="mobile"
                :to="playLink"
              >
                {{ playLabel }}
              </v-btn>
              <download-button
                v-if="type === 'movie' || target"
                :id="id"
                :type="type"
                :imdb-id="media.imdbId"
                :season="target?.season"
                :episode="target?.episode"
                :size="mobile ? 'default' : 'large'"
              />
              <torrent-picker
                v-if="type === 'movie' || target"
                :id="id"
                :type="type"
                :imdb-id="media.imdbId"
                :season="target?.season"
                :episode="target?.episode"
                :size="mobile ? 'default' : 'large'"
              />
              <v-btn
                v-if="media.trailer"
                :prepend-icon="mdiYoutube"
                :size="mobile ? 'default' : 'large'"
                variant="tonal"
                @click="trailer = true"
              >
                {{ $t('Trailer') }}
              </v-btn>
              <!-- Beside the other ways to get this playing, rather than in
                   Settings: it is a fact about this title, not a preference. -->
              <local-file-button
                v-if="type === 'movie' || target"
                :id="id"
                :type="type"
                :season="target?.season"
                :episode="target?.episode"
                :size="mobile ? 'default' : 'large'"
              />
              <v-spacer v-if="mobile" />
              <!-- Whole-title mark. For a show that's a manual override — the
                   app can't know every episode has been seen without a season
                   fetch, and the per-episode ticks already say it. -->
              <v-btn icon variant="text" color="on-surface" :size="mobile ? 'default' : 'large'" @click="library.toggleWatched(media)">
                <v-icon :icon="library.isWatched(media) ? mdiEye : mdiEyeOutline" :color="library.isWatched(media) ? 'primary' : undefined" />
                <v-tooltip activator="parent" :text="library.isWatched(media) ? $t('Mark unwatched') : $t('Mark watched')" />
              </v-btn>
              <v-btn icon variant="text" color="on-surface" :size="mobile ? 'default' : 'large'" @click="library.toggleWatchlist(media)">
                <v-icon :icon="library.inWatchlist(media) ? mdiBookmark : mdiBookmarkOutline" :color="library.inWatchlist(media) ? 'primary' : undefined" />
                <v-tooltip activator="parent" :text="library.inWatchlist(media) ? $t('Remove from watchlist') : $t('Add to watchlist')" />
              </v-btn>
              <v-btn icon variant="text" color="on-surface" :size="mobile ? 'default' : 'large'" @click="library.toggleFavourite(media)">
                <v-icon :icon="library.isFavourite(media) ? mdiHeart : mdiHeartOutline" :color="library.isFavourite(media) ? 'primary' : undefined" />
                <v-tooltip activator="parent" :text="library.isFavourite(media) ? $t('Remove from favourites') : $t('Favourite')" />
              </v-btn>
            </div>
          </div>

          <div v-else class="flex min-w-0 flex-1 flex-col gap-3">
            <div class="animate-pulse h-10 w-2/3 max-w-sm rounded-lg bg-surface-container/60" />
            <div class="animate-pulse h-4 w-40 rounded bg-surface-container/60" />
            <div class="animate-pulse h-20 w-full max-w-2xl rounded-lg bg-surface-container/60" />
            <div class="animate-pulse h-10 w-48 rounded-lg bg-surface-container/60" />
          </div>
        </div>
      </section>

      <div class="flex flex-col gap-8">
        <!-- Above the cast: on a show this row is what the page is for — the
             way to the next episode — and the cast is something you read. -->
        <media-seasons
          v-if="type === 'tv' && media?.seasons.length"
          :key="id"
          :show-id="id"
          :seasons="media.seasons"
          :poster="media.poster"
          :show="media"
        />

        <cast-row v-if="media?.cast.length" :title="$t('Cast')" :people="media.cast" />

        <media-slider
          v-if="status !== 'pending'"
          :title="$t('More like this')"
          :request="{ path: `/${type}/${id}/recommendations`, type }"
        />
      </div>

      <!-- v-if on the iframe, not just the dialog: v-dialog keeps its content
           mounted after the first close, and YouTube would keep playing. -->
      <v-dialog v-model="trailer" max-width="1100">
        <v-card class="overflow-hidden">
          <iframe
            v-if="trailer"
            :src="`https://www.youtube-nocookie.com/embed/${media?.trailer}?autoplay=1`"
            class="aspect-video w-full border-0"
            style="zoom: var(--frame-zoom, 1)"
            allow="autoplay; encrypted-media; fullscreen"
            allowfullscreen
          />
          <v-card-actions>
            <v-btn :prepend-icon="mdiOpenInNew" size="small" variant="text" @click="openTrailer">
              {{ $t('Open on YouTube') }}
            </v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" @click="trailer = false">
              {{ $t('Close') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </template>
  </div>
</template>
