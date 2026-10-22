<script setup lang="ts">
import { mdiAlertCircleOutline, mdiArrowLeft, mdiPlay, mdiStar } from '@mdi/js'

definePageMeta({
  validate: ({ params }) => 'episode' in params && /^\d+$/.test(params.season) && /^\d+$/.test(params.episode),
})

const route = useRoute()
const ui = useUiStore()
const { mobile } = useDisplay()

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

        <!-- Laid out by the width the page actually has, not the window's: the
             sidebar, the rail and a television's 1280 viewport are three very
             different columns inside one breakpoint. At the window's `lg` the
             still took a fixed 672px and left a TV ~400px for the rest, so the
             credits truncated to "Micha…" and the buttons wrapped in two.

             Three shapes from one grid, the show page's `media-hero` turned on
             its side because a still is wide where a poster is tall: stacked
             on a phone; from 48rem the still keeps company with the title and
             overview while credits and actions take the full width beneath;
             from 80rem the still spans both rows and everything else sits in
             a column beside it. -->
        <div class="@container">
          <div class="grid gap-x-8 gap-y-5 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] @7xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @7xl:gap-y-4">
            <!-- `self-start`: sized by its aspect ratio, which a grid item's
                 default stretch would fight over a two-row span. -->
            <div class="aspect-video w-full self-start overflow-hidden rounded-2xl shadow-2xl @7xl:row-span-2">
              <media-poster :src="stillUrl(episode?.still, 'w780')" :alt="episode?.name" />
            </div>

            <template v-if="episode">
              <div class="min-w-0 flex flex-col gap-3 @3xl:self-center @7xl:self-end">
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
              </div>

              <div class="min-w-0 flex flex-col gap-4 @3xl:col-span-2 @7xl:col-span-1 @7xl:self-start">
                <!-- Each credit is a label and its names, and the names wrap
                     rather than truncate: a writing credit is often three
                     people, and "Graha…" names nobody. -->
                <dl v-if="credits.length" class="flex flex-wrap gap-x-8 gap-y-1.5 text-body-small">
                  <div v-for="row in credits" :key="row.label" class="min-w-0 flex gap-2">
                    <dt class="shrink-0 opacity-50">
                      {{ row.label }}
                    </dt>
                    <dd class="opacity-85">
                      {{ row.value }}
                    </dd>
                  </div>
                </dl>

                <div class="flex flex-wrap items-center gap-2">
                  <v-btn
                    :prepend-icon="mdiPlay"
                    :size="mobile ? 'default' : 'large'"
                    :block="mobile"
                    :to="watchLink('tv', id, seasonNumber, episodeNumber)"
                  >
                    {{ $t('Play') }}
                  </v-btn>
                  <download-button
                    :id="id"
                    type="tv"
                    :imdb-id="show?.imdbId"
                    :season="seasonNumber"
                    :episode="episodeNumber"
                    :size="mobile ? 'default' : 'large'"
                  />
                  <torrent-picker
                    :id="id"
                    type="tv"
                    :imdb-id="show?.imdbId"
                    :season="seasonNumber"
                    :episode="episodeNumber"
                    :size="mobile ? 'default' : 'large'"
                  />
                  <local-file-button
                    :id="id"
                    type="tv"
                    :season="seasonNumber"
                    :episode="episodeNumber"
                    :size="mobile ? 'default' : 'large'"
                  />
                  <watched-button
                    :show-id="id"
                    :season="seasonNumber"
                    :episode="episodeNumber"
                    :show="show"
                    :size="mobile ? 'default' : 'large'"
                  />
                </div>
              </div>
            </template>

            <div v-else class="min-w-0 flex flex-col gap-3 @3xl:self-center">
              <div class="animate-pulse h-10 w-2/3 max-w-sm rounded-lg bg-surface-container/60" />
              <div class="animate-pulse h-4 w-40 rounded bg-surface-container/60" />
              <div class="animate-pulse h-20 w-full rounded-lg bg-surface-container/60" />
            </div>
          </div>
        </div>
      </section>

      <cast-row v-if="!pending && episode?.guests.length" :title="$t('Guest stars')" :people="episode.guests" />
    </template>
  </div>
</template>
