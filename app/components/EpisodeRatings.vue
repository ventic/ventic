<script setup lang="ts">
import type { EpisodeRating, Season } from '~/utils/tmdb'

/**
 * Every episode of a show, a row per season, shaded by its TMDB rating — where
 * the show peaks, and the run of it people skip.
 *
 * Each cell is a link to its episode, so a remote walks the grid like any other
 * and OK opens what it lands on. The number is in the cell, so the shade is
 * never the only thing saying how good an episode is; it is the theme's own
 * primary mixed into the surface, so it is right in all 28 themes and in light
 * and dark without a palette of its own.
 *
 * Fetched only when it scrolls into reach: it is every season of the show, and
 * on a television nobody may scroll this far.
 */
const props = defineProps<{ showId: string, seasons: Season[] }>()

const library = useLibraryStore()

const { data, status, execute } = useEpisodeRatings(() => props.showId, () => props.seasons.map(s => s.number))

const root = ref<HTMLElement | null>(null)
const { stop } = useIntersectionObserver(root, ([entry]) => {
  if (entry?.isIntersecting) {
    stop()
    execute()
  }
}, { rootMargin: '400px' })

/**
 * Until the ratings arrive, the grid is drawn from the season list the page
 * already has — the links need nothing more than the numbers. Waiting for the
 * fetch left nothing here to land on, and a remote pressing down from the cast
 * went straight past the grid to the recommendations below it.
 */
const rows = computed(() => data.value
  ? data.value.filter(s => s.episodes.length)
  : props.seasons.map(s => ({
      number: s.number,
      episodes: Array.from({ length: s.episodes }, (_, i): EpisodeRating => ({ number: i + 1, name: '', rating: 0, votes: 0, air: '' })),
    })))
const scale = computed(() => ratingScale(rows.value.flatMap(s => s.episodes)))
const widest = computed(() => Math.max(0, ...rows.value.map(s => s.episodes.length)))

// Nothing rated at all is a show too new for a grid, not a grid of dashes.
const empty = computed(() => status.value === 'success' && scale.value.hi === 0)

function mix(t: number) {
  return `color-mix(in oklab, rgb(var(--v-theme-primary)) ${Math.round(6 + t * 94)}%, rgb(var(--v-theme-surface-container-high)))`
}

function shade(e: EpisodeRating) {
  if (!e.votes)
    return undefined
  const t = scale.value.at(e.rating)
  // Past halfway the cell is closer to primary than to the surface, and the
  // ink that reads on it is on-primary's.
  return { background: mix(t), color: t > 0.5 ? 'rgb(var(--v-theme-on-primary))' : undefined }
}

function label(season: number, e: EpisodeRating) {
  return [`S${season} E${e.number}`, e.name].filter(Boolean).join(' · ')
}

// The cells are plain links, not `nuxt-link`s with a tooltip each. Both are a
// component per cell — Vuetify's tooltip directive mounts a whole overlay for
// every element it is on, shown or not — and The Simpsons is 800 cells: the
// grid took six seconds to appear on the test TV, nearly all of it mounting
// those, and a television hides the tooltips anyway. So one click handler
// routes for all of them, and one line names the cell in hand.
function open(e: MouseEvent) {
  const a = (e.target as Element).closest('a')
  if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return
  e.preventDefault()
  navigateTo(a.getAttribute('href')!)
}

/**
 * The episode under the pointer or the remote, by name — which the number in
 * the cell is not, and which a remote had no other way to learn. Written to the
 * element rather than through a ref: a ref read in this template re-renders all
 * 800 cells on every press of the d-pad.
 */
const caption = ref<HTMLElement | null>(null)

function name(e: Event) {
  const cell = (e.target as Element).closest<HTMLElement>('[data-cell]')
  if (!cell || !caption.value)
    return
  const [season, episode] = cell.dataset.cell!.split(':').map(Number)
  const ep = rows.value.find(s => s.number === season)?.episodes.find(x => x.number === episode)
  caption.value.textContent = ep ? label(season!, ep) : ''
}

const legend = computed(() => `linear-gradient(to right, ${mix(0)}, ${mix(0.5)}, ${mix(1)})`)
</script>

<template>
  <section v-if="!empty" ref="root">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 md:px-6">
      <h2 class="text-title-large">
        {{ $t('Episode ratings') }}
      </h2>
      <span ref="caption" class="min-w-0 truncate text-body-medium opacity-80" aria-hidden="true" />
      <v-spacer />
      <!-- ltr in every language: a gradient's direction is physical, and a
           scale with its numbers mirrored round it reads backwards. -->
      <div v-if="scale.hi" dir="ltr" class="flex items-center gap-2 text-label-medium opacity-70">
        <span>{{ scale.lo.toFixed(1) }}</span>
        <div class="h-2 w-24 rounded-full" :style="{ background: legend }" />
        <span>{{ scale.hi.toFixed(1) }}</span>
      </div>
    </div>

    <div class="overflow-x-auto scroll-px-4 overscroll-x-contain md:scroll-px-6 no-scrollbar">
      <div class="w-max flex flex-col gap-0.5 px-4 pt-2 md:px-6" @click="open" @focusin="name" @pointerover="name">
        <div v-if="rows.length" class="flex gap-0.5 text-label-small opacity-50" aria-hidden="true">
          <span class="w-9 shrink-0" />
          <span v-for="n in widest" :key="n" class="w-11 shrink-0 text-center">{{ n }}</span>
        </div>

        <div v-for="season in rows" :key="season.number" class="flex items-center gap-0.5">
          <span class="w-9 shrink-0 text-label-large opacity-60">S{{ season.number }}</span>
          <a
            v-for="e in season.episodes"
            :key="e.number"
            :href="episodeLink(showId, season.number, e.number)"
            :data-cell="`${season.number}:${e.number}`"
            :aria-label="`${label(season.number, e)}${e.votes ? ` · ${e.rating.toFixed(1)}` : ''}`"
            class="relative grid h-9 w-11 shrink-0 place-items-center rounded text-label-large tabular-nums outline-none transition-[filter] hover:brightness-115 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-surface"
            :class="e.votes ? '' : 'border border-outline-variant opacity-50'"
            :style="shade(e)"
          >
            {{ e.votes ? e.rating.toFixed(1) : '–' }}
            <!-- Watched, as a mark rather than a tint: the tint is the rating. -->
            <span
              v-if="library.episodeProgress(showId, season.number, e.number)?.watched"
              class="absolute right-1 top-1 size-1.5 rounded-full bg-current"
            />
          </a>
        </div>
      </div>
    </div>
  </section>
</template>
