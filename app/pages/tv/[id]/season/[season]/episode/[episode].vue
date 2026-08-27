<script setup lang="ts">
import { mdiAlertCircleOutline, mdiArrowLeft, mdiPlay, mdiStar } from '@mdi/js'

definePageMeta({
  validate: ({ params }) => 'episode' in params && /^\d+$/.test(params.season) && /^\d+$/.test(params.episode),
})

const route = useRoute()
const ui = useUiStore()

const id = computed(() => String(route.params.id))
const seasonNumber = computed(() => Number(route.params.season))
const episodeNumber = computed(() => Number(route.params.episode))

// Cached by the show page under the same key when you arrive from it.
const { data: show } = useMediaDetail('tv', id)
const { data: episode, pending, error } = useEpisode(id, seasonNumber, episodeNumber)

let mine = 0
watch(show, value => value && (mine = ui.select(value)), { immediate: true })
onUnmounted(() => ui.release(mine))

const credits = computed(() => {
  const e = episode.value
  if (!e)
    return []
  return [
    { label: e.directors.length > 1 ? $t('Directors') : $t('Director'), value: e.directors.join(', ') },
    { label: e.writers.length > 1 ? $t('Writers') : $t('Writer'), value: e.writers.join(', ') },
  ].filter(row => row.value)
})
</script>

<template>
  <div class="h-full overflow-y-auto pb-12">
    <div v-if="error" class="flex h-full flex-col items-center justify-center gap-2">
      <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
      <span class="text-body-medium opacity-70">{{ $t('Couldn\'t load this episode.') }}</span>
      <v-btn variant="tonal" :to="seasonLink(id, seasonNumber)">
        {{ $t('Back to season') }}
      </v-btn>
    </div>

    <template v-else>
      <section class="px-4 pb-8 pt-4 md:px-6">
        <div class="mb-3 flex flex-wrap items-center gap-1 -ml-2">
          <v-btn :prepend-icon="mdiArrowLeft" variant="text" size="small" :to="localePath(`/tv/${id}`)">
            {{ show?.title ?? $t('Show') }}
          </v-btn>
          <span class="opacity-40">/</span>
          <v-btn variant="text" size="small" :to="seasonLink(id, seasonNumber)">
            {{ $t('Season {number}', { number: seasonNumber }) }}
          </v-btn>
        </div>

        <div class="flex flex-col gap-6 lg:flex-row lg:items-end">
          <!-- Stills are 16:9, so this hero is wide where the show page is tall. -->
          <div class="aspect-video w-full shrink-0 overflow-hidden rounded-2xl shadow-2xl lg:w-2xl">
            <media-poster :src="stillUrl(episode?.still, 'w780')" :alt="episode?.name" />
          </div>

          <div v-if="episode" class="flex min-w-0 flex-1 flex-col gap-3">
            <div class="text-label-medium uppercase opacity-60">
              S{{ seasonNumber }} E{{ episodeNumber }}
            </div>
            <h1 class="text-headline-large font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
              {{ episode.name || $t('Episode {number}', { number: episodeNumber }) }}
            </h1>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small opacity-75">
              <span v-if="episode.rating" class="flex items-center gap-1 opacity-100">
                <v-icon :icon="mdiStar" size="14" class="text-amber-400" />
                <span class="font-medium">{{ episode.rating.toFixed(1) }}</span>
                <span class="opacity-60">({{ episode.votes.toLocaleString(uiLocale()) }})</span>
              </span>
              <span v-if="episode.air">{{ dateText(episode.air) }}</span>
              <span v-if="episode.runtime">{{ runtimeText(episode.runtime) }}</span>
            </div>

            <p class="max-w-3xl text-body-medium opacity-85">
              {{ episode.overview || $t('No overview.') }}
            </p>

            <dl v-if="credits.length" class="grid grid-cols-1 gap-x-6 gap-y-1 text-body-small sm:grid-cols-2">
              <div v-for="row in credits" :key="row.label" class="flex gap-2">
                <dt class="shrink-0 opacity-50">
                  {{ row.label }}
                </dt>
                <dd class="truncate opacity-85">
                  {{ row.value }}
                </dd>
              </div>
            </dl>

            <div class="flex flex-wrap items-center gap-2 pt-2">
              <v-btn :prepend-icon="mdiPlay" size="large" :to="watchLink('tv', id, seasonNumber, episodeNumber)">
                {{ $t('Play') }}
              </v-btn>
              <download-button
                :id="id"
                type="tv"
                :imdb-id="show?.imdbId"
                :season="seasonNumber"
                :episode="episodeNumber"
                size="large"
              />
              <torrent-picker
                :id="id"
                type="tv"
                :imdb-id="show?.imdbId"
                :season="seasonNumber"
                :episode="episodeNumber"
                size="large"
              />
              <local-file-button
                :id="id"
                type="tv"
                :season="seasonNumber"
                :episode="episodeNumber"
                size="large"
              />
              <watched-button
                :show-id="id"
                :season="seasonNumber"
                :episode="episodeNumber"
                :show="show"
                size="large"
              />
            </div>
          </div>

          <div v-else class="flex min-w-0 flex-1 flex-col gap-3">
            <div class="animate-pulse h-10 w-2/3 max-w-sm rounded-lg bg-surface-container/60" />
            <div class="animate-pulse h-4 w-40 rounded bg-surface-container/60" />
            <div class="animate-pulse h-20 w-full rounded-lg bg-surface-container/60" />
          </div>
        </div>
      </section>

      <cast-row v-if="!pending && episode?.guests.length" :title="$t('Guest stars')" :people="episode.guests" />
    </template>
  </div>
</template>
