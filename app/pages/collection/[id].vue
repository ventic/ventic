<script setup lang="ts">
import { mdiAlertCircleOutline, mdiMovieOpenOutline, mdiPlay } from '@mdi/js'

/**
 * A film series as a page of its own — every Harry Potter, every Toy Story —
 * opened from the series row on any one of its films. TMDB keeps no index of
 * collections to browse, so a film is the way in; what this adds over that row
 * is the series' own art and overview, how much of it you have seen, and one
 * press to the next film.
 */
definePageMeta({
  validate: ({ params }) => 'id' in params && /^\d+$/.test(String(params.id)),
})

const route = useRoute()
const ui = useUiStore()
const library = useLibraryStore()
const { mobile } = useDisplay()

const id = computed(() => Number(route.params.id))
const { data: collection, status, error } = useCollection(id)

// The series' backdrop, carried by its first film: the window's art is a
// title's, and the first film is the one the series is known by.
let mine = 0
watch(collection, c => {
  const first = c?.parts[0]
  if (first)
    mine = ui.select({ ...first, backdrop: c.backdrop ?? first.backdrop })
}, { immediate: true })
onUnmounted(() => ui.release(mine))

const parts = computed(() => collection.value?.parts ?? [])
const seen = computed(() => parts.value.filter(m => library.isWatched(m)).length)

/**
 * What Play starts: the first film not yet seen, in release order. One with no
 * date, or a year still ahead, isn't out — a Play that finds no release is
 * worse than no button.
 */
const thisYear = new Date().getFullYear()
const next = computed(() => parts.value.find(m => !library.isWatched(m) && m.year && Number(m.year) <= thisYear))

const meta = computed(() => {
  const list = parts.value
  if (!list.length)
    return []
  const years = list.map(m => m.year).filter(Boolean)
  const first = years[0]
  const last = years.at(-1)
  return [
    $t('{count} films', { count: list.length }),
    first && last && first !== last ? `${first}–${last}` : first,
    seen.value ? $t('{watched} of {total} watched', { watched: seen.value, total: list.length }) : '',
  ].filter(Boolean)
})
</script>

<template>
  <div class="h-full overflow-y-auto pb-12">
    <div v-if="error" class="flex h-full flex-col items-center justify-center gap-2">
      <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
      <span class="text-body-medium opacity-70">{{ $t('Couldn\'t load this collection.') }}</span>
      <v-btn variant="tonal" :to="localePath('/')">
        {{ $t('Go home') }}
      </v-btn>
    </div>

    <template v-else>
      <section class="px-4 pb-8 pt-4 md:px-6">
        <div class="media-hero">
          <div class="media-hero-poster">
            <media-poster :src="posterUrl(collection?.poster, 'w500')" :alt="collection?.name" :icon="mdiMovieOpenOutline" />
          </div>

          <h1 v-if="collection" class="text-headline-medium min-w-0 self-center font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] sm:text-headline-large">
            {{ collection.name }}
          </h1>

          <div v-if="collection" class="media-hero-body">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small opacity-75">
              <span v-for="part in meta" :key="part">{{ part }}</span>
            </div>

            <p v-if="collection.overview" class="max-w-3xl text-body-medium opacity-85">
              {{ collection.overview }}
            </p>

            <!-- First in the DOM of anything to press, so it is where a remote
                 lands: carrying on with a series is what opening one is for. -->
            <div v-if="next" class="flex pt-2">
              <v-btn
                :prepend-icon="mdiPlay"
                :size="mobile ? 'default' : 'large'"
                :block="mobile"
                :to="watchLink('movie', next.id)"
                class="max-w-full"
              >
                <span class="truncate">{{ $t('Play {title}', { title: next.title }) }}</span>
              </v-btn>
            </div>
          </div>

          <div v-else class="media-hero-body self-center">
            <div class="animate-pulse h-10 w-2/3 max-w-sm rounded-lg bg-surface-container/60" />
            <div class="animate-pulse h-4 w-40 rounded bg-surface-container/60" />
            <div class="animate-pulse h-20 w-full max-w-2xl rounded-lg bg-surface-container/60" />
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-3 px-4 md:px-6">
        <h2 class="text-title-large">
          {{ $t('Films') }}
        </h2>

        <div class="grid gap-x-4 gap-y-5" :style="{ gridTemplateColumns: ui.gridColumns }">
          <media-card
            v-for="part in parts"
            :key="part.id"
            :media="part"
            :detail="ui.isDetailed"
          />
          <div
            v-for="n in status === 'pending' ? 6 : 0"
            :key="`skeleton-${n}`"
            class="animate-pulse aspect-2/3 rounded-xl bg-surface-container/60"
          />
        </div>

        <div v-if="status !== 'pending' && !parts.length" class="flex flex-col items-center gap-2 py-8">
          <v-icon :icon="mdiMovieOpenOutline" size="40" class="opacity-30" />
          <span class="text-body-medium opacity-70">{{ $t('Nothing here.') }}</span>
        </div>
      </section>
    </template>
  </div>
</template>
