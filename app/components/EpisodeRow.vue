<script setup lang="ts">
import type { Episode, Media } from '~/utils/tmdb'
import { mdiCheck, mdiPlay, mdiStar } from '@mdi/js'

// `show` is only passed through to the watched button, for the card snapshot.
const props = defineProps<{ showId: string, season: number, episode: Episode, show?: Media | null }>()

const library = useLibraryStore()

const progress = computed(() => library.episodeProgress(props.showId, props.season, props.episode.number))
const played = computed(() => fraction(progress.value))

function play() {
  navigateTo(watchLink('tv', props.showId, props.season, props.episode.number))
}
</script>

<template>
  <!-- flex-wrap plus `w-full sm:w-auto` on the buttons: on a phone they take a
       line of their own, which is what gives the title somewhere to be. Side by
       side they left it about two characters wide. -->
  <nuxt-link
    :to="episodeLink(showId, season, episode.number)"
    class="group flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl bg-surface-container/30 p-2 outline-none transition-colors hover:bg-surface-container-high/70 focus-visible:ring-2 focus-visible:ring-primary"
  >
    <div class="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg sm:w-44">
      <media-poster :src="stillUrl(episode.still)" :alt="episode.name" />
      <div class="grid place-items-center absolute inset-0 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <v-icon :icon="mdiPlay" size="28" class="text-white" />
      </div>
      <div v-if="played > 0 && !progress?.watched" class="absolute inset-x-0 bottom-0 h-1 bg-black/60">
        <div class="h-full bg-primary" :style="{ width: `${played * 100}%` }" />
      </div>
    </div>

    <div class="min-w-0 flex-1 basis-40 py-1">
      <div class="flex items-baseline gap-2">
        <span class="text-body-small shrink-0 opacity-50">{{ episode.number }}</span>
        <v-icon v-if="progress?.watched" :icon="mdiCheck" size="16" color="primary" :title="$t('Watched')" />
        <span class="truncate text-title-small">{{ episode.name }}</span>
        <v-spacer />
        <span v-if="episode.rating" class="flex shrink-0 items-center gap-0.5 text-body-small opacity-70">
          <v-icon :icon="mdiStar" size="12" class="text-amber-400" />
          {{ episode.rating.toFixed(1) }}
        </span>
      </div>
      <div class="flex gap-2 pt-0.5 text-body-small opacity-50">
        <span>{{ dateText(episode.air) }}</span>
        <span v-if="episode.runtime">· {{ runtimeText(episode.runtime) }}</span>
      </div>
      <p class="line-clamp-2 pt-1 text-body-small opacity-70">
        {{ episode.overview || $t('No overview.') }}
      </p>
    </div>

    <div class="flex w-full shrink-0 items-center justify-end gap-1 sm:mt-1 sm:w-auto">
      <!-- The row opens the episode page; only this button starts playback. -->
      <v-btn :prepend-icon="mdiPlay" size="small" variant="tonal" @click.stop.prevent="play">
        {{ $t('Play') }}
      </v-btn>

      <!-- Says you've seen it without playing it, which is what moves the show
           page's Play button on to the next episode. -->
      <watched-button
        :show-id="showId"
        :season="season"
        :episode="episode.number"
        :show="show"
        size="small"
      />
    </div>
  </nuxt-link>
</template>
