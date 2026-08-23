<script setup lang="ts">
import type { LibraryKind, LibrarySort } from '~/utils/library'
import type { Media } from '~/utils/tmdb'
import { mdiSortVariant } from '@mdi/js'

/**
 * Favourites, the Watchlist and History are the same page three times: a list
 * that is already entirely in localStorage, narrowed and reordered on the way to
 * the grid. Nothing pages in, so the layout's loading and error states never
 * fire here.
 *
 * `recent` names the list's own order, which is the default sort and differs per
 * page — added, or last played.
 */
const props = defineProps<{
  title: string
  items: Media[]
  recent: string
}>()

const { lgAndUp } = useDisplay()

/** The three the sidebar already splits the app into, plus everything. */
const KINDS = computed<{ value: LibraryKind, title: string }[]>(() => [
  { value: 'all', title: $t('All') },
  { value: 'movie', title: $t('Movies') },
  { value: 'tv', title: $t('TV Shows') },
  { value: 'anime', title: $t('Anime') },
])

const query = ref('')
const kind = ref<LibraryKind>('all')
const sort = ref<LibrarySort>('recent')
const reverse = ref(false)

// Each option leads with its useful end, so one Reverse toggle covers direction
// for all of them and no label has to lie about which way it is pointing.
const sorts = computed(() => [
  { value: 'recent', title: props.recent },
  { value: 'title', title: $t('Title') },
  { value: 'year', title: $t('Year') },
  { value: 'rating', title: $t('Rating') },
])

const shown = computed(() => arrange(props.items, {
  query: query.value,
  kind: kind.value,
  sort: sort.value,
  reverse: reverse.value,
}))

// What the filter button counts: with the sheet shut, a filter left on from a
// moment ago is otherwise invisible. Only what is actually behind the button —
// where the chips are up, the bucket is on the bar for anyone to see.
const active = computed(() =>
  (query.value.trim() ? 1 : 0)
  + (!lgAndUp.value && kind.value !== 'all' ? 1 : 0)
  + (sort.value === 'recent' && !reverse.value ? 0 : 1))
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Measured, not guessed: title and chips 370, search 192, sort 160,
         Reverse 105, poster slider 160, layout toggle 84, six gaps — 1119, so
         1150 with a little slack. The two regimes agree on it, because the
         width the chips take below lg is the width the Show select takes back
         above it. -->
    <options-bar :active="active" :needs="1150">
      <div class="flex min-w-0 items-center gap-4">
        <h1 class="text-title-large shrink-0">
          {{ title }}
        </h1>

        <!-- Chips from lg up, where a remote reaches a bucket in one press —
             a television is 1280 wide, so it gets them. Below that they'd crowd
             the bar on their own, so the same choice moves into the filters as
             a dropdown; MediaBrowser does exactly this with its categories. -->
        <v-chip-group
          v-if="lgAndUp"
          v-model="kind"
          mandatory
          selected-class="bg-primary text-on-primary font-medium"
        >
          <v-chip
            v-for="option in KINDS"
            :key="option.value"
            :value="option.value"
            :text="option.title"
            size="small"
          />
        </v-chip-group>
      </div>

      <!-- Inline on a wide window, in a bottom sheet on a phone. The `md:`
           widths are the bar's; in the sheet each one takes the full row. -->
      <template #filters>
        <v-select
          v-if="!lgAndUp"
          v-model="kind"
          :items="KINDS"
          item-title="title"
          item-value="value"
          :label="$t('Show')"
          class="w-40 shrink-0"
        />

        <search-field
          v-model="query"
          :placeholder="$t('Filter by title')"
          class="w-48 shrink-0"
        />

        <v-select
          v-model="sort"
          :items="sorts"
          item-title="title"
          item-value="value"
          :label="$t('Sort by')"
          class="w-40 shrink-0"
        />

        <v-btn
          :prepend-icon="mdiSortVariant"
          :variant="reverse ? 'tonal' : 'text'"
          :color="reverse ? 'primary' : 'on-surface'"
          class="shrink-0"
          @click="reverse = !reverse"
        >
          {{ $t('Reverse') }}
        </v-btn>
      </template>
    </options-bar>

    <div class="min-h-0 flex-1">
      <media-layout :items="shown" :pending="false" done />
    </div>
  </div>
</template>
