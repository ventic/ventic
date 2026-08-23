<script setup lang="ts">
import { mdiAlertCircleOutline, mdiArrowLeft, mdiMovieOpenOutline } from '@mdi/js'

definePageMeta({
  validate: ({ params }) => 'season' in params && /^\d+$/.test(params.season),
})

const route = useRoute()
const ui = useUiStore()

const id = computed(() => String(route.params.id))
const number = computed(() => Number(route.params.season))

// Same cache key as the show page, so arriving from it costs no request.
const { data: show } = useMediaDetail('tv', id)
const { data: season, pending, error } = useSeason(id, number)

let mine = 0
watch(show, value => value && (mine = ui.select(value)), { immediate: true })
onUnmounted(() => ui.release(mine))

const others = computed(() => show.value?.seasons.filter(s => s.number !== number.value) ?? [])
</script>

<template>
  <div class="h-full overflow-y-auto pb-12">
    <div v-if="error" class="flex h-full flex-col items-center justify-center gap-2">
      <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
      <span class="text-body-medium opacity-70">{{ $t('Couldn\'t load this season.') }}</span>
      <v-btn variant="tonal" :to="localePath(`/tv/${id}`)">
        {{ $t('Back to show') }}
      </v-btn>
    </div>

    <template v-else>
      <section class="px-4 pb-8 pt-4 md:px-6">
        <v-btn :prepend-icon="mdiArrowLeft" variant="text" size="small" class="mb-3 -ml-2" :to="localePath(`/tv/${id}`)">
          {{ show?.title ?? $t('Back to show') }}
        </v-btn>

        <div class="flex flex-col gap-6 sm:flex-row sm:items-end">
          <div class="aspect-2/3 w-32 shrink-0 overflow-hidden rounded-2xl shadow-2xl sm:w-40">
            <media-poster :src="posterUrl(season?.poster ?? show?.poster, 'w342')" :alt="season?.name" />
          </div>

          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <h1 class="text-headline-large font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
              {{ season?.name ?? $t('Season {number}', { number }) }}
            </h1>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small opacity-75">
              <span v-if="season?.air">{{ dateText(season.air) }}</span>
              <span v-if="season?.episodes.length">{{ $t('{count} episodes', { count: season.episodes.length }) }}</span>
              <span v-if="show?.certification" class="rounded border border-outline-variant px-1.5 py-0.5 text-label-small">
                {{ show.certification }}
              </span>
            </div>

            <p v-if="season?.overview" class="max-w-3xl text-body-medium opacity-85">
              {{ season.overview }}
            </p>

            <div v-if="others.length" class="flex flex-wrap gap-1.5">
              <v-chip
                v-for="other in others"
                :key="other.number"
                size="small"
                :text="other.name"
                :to="seasonLink(id, other.number)"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-2 px-4 md:px-6">
        <episode-row
          v-for="episode in season?.episodes"
          :key="episode.number"
          :show-id="id"
          :season="number"
          :episode="episode"
          :show="show"
        />

        <div
          v-for="n in pending && !season ? 6 : 0"
          :key="`skeleton-${n}`"
          class="animate-pulse h-26 rounded-xl bg-surface-container/60"
        />

        <div v-if="!pending && !season?.episodes.length" class="flex flex-col items-center gap-2 py-8">
          <v-icon :icon="mdiMovieOpenOutline" size="40" class="opacity-30" />
          <span class="text-body-medium opacity-70">{{ $t('No episodes listed.') }}</span>
        </div>
      </section>
    </template>
  </div>
</template>
