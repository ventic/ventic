<script setup lang="ts">
import type { Media, Season } from '~/utils/tmdb'
import { mdiCheck, mdiEye, mdiEyeOutline } from '@mdi/js'

/**
 * The show's seasons as cards, each opening the season's own page.
 *
 * This used to be a dropdown with the chosen season's episodes listed under it,
 * which put a scrolling list of long rows on the end of the show page — hard
 * work with a remote, and it fetched a season's episodes before anyone asked
 * for them. A row of posters is the same shape as everything else on the page,
 * so the d-pad walks it the same way, and the episodes live on the page that is
 * already built for them.
 *
 * `show` is only the card snapshot the mark writes to History; the marking
 * itself works from the id alone.
 */
const props = defineProps<{ showId: string, seasons: Season[], poster?: string | null, show?: Media | null }>()

const library = useLibraryStore()
const ui = useUiStore()

/** Watched episodes per season — TMDB's count is the denominator. */
function seen(season: Season) {
  return Math.min(library.seasonWatched(props.showId, season.number), season.episodes)
}

const done = (season: Season) => seen(season) >= season.episodes

const target = () => props.show ?? { id: Number(props.showId), type: 'tv' as const }

// The season just marked, and the dialog's model with it.
const asked = ref<Season | null>(null)

const earlier = computed(() =>
  asked.value ? props.seasons.filter(s => s.number < asked.value!.number && !done(s)) : [])

function toggle(season: Season) {
  const complete = done(season)
  library.markSeason(target(), season.number, season.episodes, !complete)
  // Only on the way in: starting a show at season 3 usually means the first two
  // were watched somewhere else. Same offer an episode row makes, a season up.
  if (!complete && props.seasons.some(s => s.number < season.number && !done(s)))
    asked.value = season
}

function markEarlier() {
  for (const season of earlier.value)
    library.markSeason(target(), season.number, season.episodes, true)
  asked.value = null
}
</script>

<template>
  <scroll-row :title="$t('Seasons')">
    <nuxt-link
      v-for="season in seasons"
      :key="season.number"
      :to="seasonLink(showId, season.number)"
      class="group block shrink-0 select-none outline-none"
      :style="{ width: `${ui.cardWidth}px` }"
    >
      <div class="relative aspect-2/3 overflow-hidden rounded-xl bg-surface-container">
        <media-poster :src="posterUrl(season.poster ?? poster, ui.posterSize)" :alt="season.name" />

        <!-- Shape as well as colour, like a card's: at 10 feet a tinted bar is
             the only thing that carries, and a full one has none left to show. -->
        <div v-if="done(season)" class="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-on-primary">
          <svg viewBox="0 0 24 24" class="size-3.5 fill-current"><path :d="mdiCheck" /></svg>
        </div>
        <div v-else-if="seen(season)" class="absolute inset-x-0 bottom-0 h-1 bg-black/60">
          <div class="h-full bg-primary" :style="{ width: `${(seen(season) / season.episodes) * 100}%` }" />
        </div>

        <!-- Inside the poster, like MediaCard's: an outside ring is clipped by
             the row's own scroll container. -->
        <div class="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-inset ring-primary transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>

      <div class="truncate pt-2 text-title-small">
        {{ season.name }}
      </div>

      <!-- A real focusable button rather than a card overlay: this is the one
           thing on the row a remote has to be able to reach, and it sits below
           the posters so walking sideways still steps card to card. -->
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-body-small opacity-55">
          {{ seen(season)
            ? $t('{seen}/{total} watched', { seen: seen(season), total: season.episodes })
            : $t('{count} episodes', { count: season.episodes }) }}
        </span>
        <v-btn icon size="small" variant="text" color="on-surface" @click.stop.prevent="toggle(season)">
          <v-icon :icon="done(season) ? mdiEye : mdiEyeOutline" size="20" :color="done(season) ? 'primary' : undefined" />
          <v-tooltip activator="parent" :text="done(season) ? $t('Mark season unwatched') : $t('Mark season watched')" />
        </v-btn>
      </div>
    </nuxt-link>
  </scroll-row>

  <v-dialog :model-value="!!asked" max-width="420" @update:model-value="asked = null">
    <v-card>
      <v-card-title class="text-title-medium">
        {{ $t('Mark the earlier seasons too?') }}
      </v-card-title>
      <!-- One sentence per count, not a fragment plus a verb: which words agree
           with the number is the translator's to solve. -->
      <v-card-text class="text-body-medium opacity-80">
        {{ earlier.length === 1
          ? $t('One earlier season is still unwatched.')
          : $t('{count} earlier seasons are still unwatched.', { count: earlier.length }) }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="asked = null">
          {{ $t('No') }}
        </v-btn>
        <v-btn autofocus variant="tonal" @click="markEarlier">
          {{ $t('Mark watched') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
