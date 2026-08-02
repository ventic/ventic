<script setup lang="ts">
import type { Season } from '~/utils/tmdb'

/**
 * The show's seasons as cards, each opening the season's own page.
 *
 * This used to be a dropdown with the chosen season's episodes listed under it,
 * which put a scrolling list of long rows on the end of the show page — hard
 * work with a remote, and it fetched a season's episodes before anyone asked
 * for them. A row of posters is the same shape as everything else on the page,
 * so the d-pad walks it the same way, and the episodes live on the page that is
 * already built for them.
 */
defineProps<{ showId: string, seasons: Season[], poster?: string | null }>()
</script>

<template>
  <scroll-row title="Seasons">
    <nuxt-link
      v-for="season in seasons"
      :key="season.number"
      :to="seasonLink(showId, season.number)"
      :title="season.name"
      class="group block w-32 shrink-0 snap-start select-none outline-none sm:w-36"
    >
      <div class="relative aspect-2/3 overflow-hidden rounded-xl bg-surface-container">
        <media-poster :src="posterUrl(season.poster ?? poster, 'w342')" :alt="season.name" />

        <!-- Inside the poster, like MediaCard's: an outside ring is clipped by
             the row's own scroll container. -->
        <div class="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-inset ring-primary transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>

      <div class="truncate pt-2 text-title-small">
        {{ season.name }}
      </div>
      <div class="truncate text-body-small opacity-55">
        {{ season.episodes }} episodes{{ season.year ? ` · ${season.year}` : '' }}
      </div>
    </nuxt-link>
  </scroll-row>
</template>
