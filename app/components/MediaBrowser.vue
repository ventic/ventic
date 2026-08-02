<script setup lang="ts">
import type { MediaType } from '~/utils/tmdb'

/**
 * `anime` narrows every list to Japanese animation. TMDB has no anime endpoint —
 * the genre + original language pair is what it gives you, and it covers far
 * more than the "anime" keyword (210024), which most titles aren't tagged with.
 */
const props = defineProps<{ type: MediaType, anime?: boolean }>()

const { lgAndUp } = useDisplay()

const isMovie = props.type === 'movie'

/** TMDB's Animation genre, in both the movie and tv lists. */
const ANIMATION = 16

const categories = [
  { value: 'popular', title: 'Popular' },
  // /trending takes no filters at all, so it can't be narrowed to anime.
  ...props.anime ? [] : [{ value: 'trending', title: 'Trending' }],
  { value: 'top_rated', title: 'Top rated' },
  isMovie
    ? { value: 'upcoming', title: 'Upcoming' }
    : { value: 'on_the_air', title: 'On the air' },
  isMovie
    ? { value: 'now_playing', title: 'In cinemas' }
    : { value: 'airing_today', title: 'Airing today' },
]

const category = ref('popular')
const genre = ref<number | null>(null)

const { data: genres } = useGenres(props.type)

const isTrending = computed(() => category.value === 'trending')
/** For the button that hides the filter on a phone — a set filter has to show. */
const filtered = computed(() => genre.value !== null)

function day(offset = 0) {
  return new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
}

// /discover carries the filters as query params; trending is its own endpoint
// and takes none, so a chosen genre rides along as `keepGenre` and the feed
// filters the fetched pages itself. Week rather than day — the day window is too
// volatile to be worth a control.
const request = computed(() => {
  if (isTrending.value)
    return { path: `/trending/${props.type}/week`, type: props.type, keepGenre: genre.value ?? undefined }

  // Sorting only accepts the release-date field; filtering a show by when it
  // airs needs air_date, which is a different field than first_air_date.
  const sortDate = isMovie ? 'primary_release_date' : 'first_air_date'
  const onDate = isMovie ? 'primary_release_date' : 'air_date'
  const sorting: Record<string, Record<string, unknown>> = {
    popular: { sort_by: 'popularity.desc' },
    top_rated: { 'sort_by': 'vote_average.desc', 'vote_count.gte': isMovie ? 300 : 150 },
    upcoming: { sort_by: `${sortDate}.asc`, [`${onDate}.gte`]: day(1) },
    now_playing: { sort_by: 'popularity.desc', [`${onDate}.gte`]: day(-45), [`${onDate}.lte`]: day() },
    on_the_air: { sort_by: 'popularity.desc', [`${onDate}.gte`]: day(), [`${onDate}.lte`]: day(7) },
    airing_today: { sort_by: 'popularity.desc', [`${onDate}.gte`]: day(), [`${onDate}.lte`]: day() },
  }

  // Comma-joined ids are an AND, so a sub-genre stacks on top of Animation.
  const genres = [...new Set([props.anime ? ANIMATION : null, genre.value].filter(g => g !== null))]

  return {
    path: `/discover/${props.type}`,
    type: props.type,
    params: {
      include_adult: false,
      with_genres: genres.join(',') || undefined,
      with_original_language: props.anime ? 'ja' : undefined,
      ...sorting[category.value],
    },
  }
})

const { items, pending, error, done, loadMore } = useMediaFeed(request)
</script>

<template>
  <div class="flex h-full flex-col">
    <options-bar :active="filtered ? 1 : 0">
      <!-- Chips only from lg up, where the row has room for five of them beside
           the genre filter, poster slider and layout toggle. Below that — a
           phone, or a desktop window in the md–lg band — they'd crowd those
           controls off the bar, so the category collapses to a dropdown. The
           filters still go inline down to md (the sheet is OptionsBar's own
           `mobile` call); only the category swaps earlier. -->
      <v-chip-group
        v-if="lgAndUp"
        v-model="category"
        mandatory
        selected-class="bg-primary text-on-primary font-medium"
      >
        <v-chip
          v-for="option in categories"
          :key="option.value"
          :value="option.value"
          :text="option.title"
          size="small"
        />
      </v-chip-group>
      <v-select
        v-else
        v-model="category"
        :items="categories"
        item-title="title"
        item-value="value"
        class="max-w-52 shrink-0 md:w-52 md:max-w-none"
      />

      <!-- Inline on a wide window, in a bottom sheet on a phone. The `md:`
           widths are the bar's; in the sheet each one takes the full row. -->
      <template #filters>
        <v-select
          v-model="genre"
          :items="genres"
          item-title="name"
          item-value="id"
          label="Genre"
          clearable
          class="w-full shrink-0 grow-0 md:w-52"
        />
      </template>
    </options-bar>

    <div class="min-h-0 flex-1">
      <media-layout
        :items="items"
        :pending="pending"
        :done="done"
        :error="error"
        @load="loadMore"
      />
    </div>
  </div>
</template>
