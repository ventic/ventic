<script setup lang="ts">
import type { Media, Season } from '~/utils/tmdb'
import { mdiOpenInNew } from '@mdi/js'

const props = defineProps<{ showId: string, seasons: Season[], show?: Media | null }>()

const season = ref(props.seasons[0]?.number ?? 1)

// Only the picked season is fetched, and never before this component mounts.
const { data: detail, pending } = useSeason(() => props.showId, season)

const picked = computed(() => props.seasons.find(s => s.number === season.value))
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3 px-4 md:px-6">
      <h2 class="text-title-large">
        Episodes
      </h2>
      <v-select
        v-model="season"
        :items="seasons"
        item-title="name"
        item-value="number"
        class="w-44 shrink-0 grow-0"
      />
      <v-btn
        :prepend-icon="mdiOpenInNew"
        size="small"
        variant="text"
        :to="seasonLink(showId, season)"
      >
        Season page
      </v-btn>
      <v-spacer />
      <span v-if="picked" class="text-body-small opacity-55">
        {{ picked.episodes }} episodes{{ picked.year ? ` · ${picked.year}` : '' }}
      </span>
    </div>

    <div class="flex flex-col gap-2 px-4 md:px-6">
      <episode-row
        v-for="episode in detail?.episodes"
        :key="episode.number"
        :show-id="showId"
        :season="season"
        :episode="episode"
        :show="show"
      />

      <div
        v-for="n in pending && !detail ? 5 : 0"
        :key="`skeleton-${n}`"
        class="animate-pulse h-26 rounded-xl bg-surface-container/60"
      />
    </div>
  </section>
</template>
