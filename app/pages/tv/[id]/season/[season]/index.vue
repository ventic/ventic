<script setup lang="ts">
import { mdiAlertCircleOutline, mdiArrowLeft, mdiCheck, mdiDownloadMultiple, mdiMovieOpenOutline } from '@mdi/js'

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

const downloads = useDownloadsStore()
const settings = useSettingsStore()
const { mobile } = useDisplay()
const tv = isTv() === true

/**
 * A whole season only where this device keeps films at all — the line
 * `prefetch` holds to. On a TV box's own 2 GB each episode fits when it is
 * asked for, and evicts the one before it as it lands.
 */
const keeps = computed(() => settings.playMode !== 'stream' && downloads.room.drive >= MIN_LIBRARY)

/** What is out: an episode with no date, or one dated after today, has nothing to find. */
const aired = computed(() => season.value?.episodes
  .filter(e => e.air && daysBetween(localDay(), e.air) <= 0)
  .map(e => e.number) ?? [])

const job = computed(() => downloads.seasons[`${id.value}:${number.value}`])

function downloadSeason() {
  downloads.fetchSeason(id.value, number.value, aired.value, {
    imdbId: show.value?.imdbId,
    named: () => show.value,
  })
}
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
        <!-- Not a stop for a remote, which has BACK for it: sat above the
             poster, the episode list was all that lay below it, so down from
             here skipped Download season and the other seasons. -->
        <v-btn :prepend-icon="mdiArrowLeft" variant="text" size="small" class="mb-3 -ml-2" :tabindex="tv ? -1 : undefined" :to="localePath(`/tv/${id}`)">
          {{ show?.title ?? $t('Back to show') }}
        </v-btn>

        <div class="media-hero">
          <div class="media-hero-poster">
            <media-poster :src="posterUrl(season?.poster ?? show?.poster, 'w342')" :alt="season?.name" />
          </div>

          <h1 class="text-headline-medium min-w-0 self-center font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] sm:text-headline-large">
            {{ season?.name ?? $t('Season {number}', { number }) }}
          </h1>

          <div class="media-hero-body">
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

            <!-- Every episode that is out, as the Download button fetches one:
                 kept whole whatever the storage setting says, and filed under
                 each episode so Play finds it. -->
            <div v-if="(keeps || job) && aired.length > 1 && show?.imdbId" class="flex flex-wrap items-center gap-3">
              <v-btn
                :prepend-icon="job && !job.running ? mdiCheck : mdiDownloadMultiple"
                :loading="job?.running"
                :size="mobile ? 'default' : 'large'"
                :to="job && !job.running ? localePath('/downloads') : undefined"
                variant="tonal"
                @click="job?.running || (job ? undefined : downloadSeason())"
              >
                {{ job && !job.running ? $t('In downloads') : $t('Download season') }}
                <template #loader>
                  <span class="flex items-center gap-2 tabular-nums">
                    <v-progress-circular indeterminate size="18" width="2" />
                    {{ $t('{done} of {total}', { done: job!.done + job!.failed, total: job!.total }) }}
                  </span>
                </template>
              </v-btn>
              <span v-if="job?.failed" class="text-body-small opacity-70">
                {{ $t('{count} couldn\'t be downloaded.', { count: job.failed }) }}
              </span>
            </div>

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
