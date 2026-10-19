<script setup lang="ts">
import type { MediaType } from '~/utils/tmdb'
import { mdiEyeOff, mdiEyeOutline } from '@mdi/js'

/**
 * `anime` narrows every list to Japanese animation. TMDB has no anime endpoint —
 * the genre + original language pair is what it gives you, and it covers far
 * more than the "anime" keyword (210024), which most titles aren't tagged with.
 */
const props = defineProps<{ type: MediaType, anime?: boolean }>()

const { lgAndUp } = useDisplay()
const profiles = useProfilesStore()
const library = useLibraryStore()
const ui = useUiStore()

const isMovie = props.type === 'movie'

const categories = computed(() => [
  { value: 'popular', title: $t('Popular') },
  // /trending takes no filters at all, so it can't be narrowed to anime — or to
  // a child's rating, short of checking pages of grown-ups' titles one by one.
  ...props.anime || profiles.current.kids ? [] : [{ value: 'trending', title: $t('Trending') }],
  { value: 'top_rated', title: $t('Top rated') },
  isMovie
    ? { value: 'upcoming', title: $t('Upcoming') }
    : { value: 'on_the_air', title: $t('On the air') },
  isMovie
    ? { value: 'now_playing', title: $t('In cinemas') }
    : { value: 'airing_today', title: $t('Airing today') },
])

const category = ref('popular')
const genre = ref<number | null>(null)

const { data: genres } = useGenres(props.type)

const isTrending = computed(() => category.value === 'trending')

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
      // A child's rating ceiling, and the NSFW anime for anyone who hasn't asked for it.
      ...profiles.discover(props.type),
      with_genres: genres.join(',') || undefined,
      with_original_language: props.anime ? 'ja' : undefined,
      ...sorting[category.value],
    },
  }
})

const { items, pending, error, done, loadMore } = useMediaFeed(request)

// Left out here rather than in the feed, so marking a title watched takes it
// off the page without a refetch, and turning the switch off puts every one
// back. A page that comes back all watched is a short grid, and a short grid
// gets no scroll to ask for the next page with — so it asks itself.
const shown = computed(() => ui.hideWatched ? items.value.filter(m => !library.isWatched(m)) : items.value)

watch([() => shown.value.length, pending], () => {
  if (ui.hideWatched && !pending.value && !done.value && !error.value && shown.value.length < 20)
    loadMore()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- The default, plus the 50px the watched toggle takes beside the layout. -->
    <options-bar :active="genre !== null ? 1 : 0" :needs="790">
      <!-- Chips only from lg up, where the row has room for five of them beside
           the genre filter, poster slider and layout toggle. Below that — a
           phone, or a desktop window in the md–lg band — they'd crowd those
           controls off the bar, so the category collapses to a dropdown. It
           stays on the bar either way; the genre filter beside it is the one
           that goes behind the button once OptionsBar runs out of room. -->
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

      <!-- Inline while the row can hold it, in a bottom sheet when it can't.
           The `md:` widths are the bar's; in the sheet it takes the full row. -->
      <template #filters>
        <v-select
          v-model="genre"
          :items="genres"
          item-title="name"
          item-value="id"
          :label="$t('Genre')"
          clearable
          class="w-52 shrink-0"
        />
      </template>

      <!-- Beside the layout toggle rather than behind the Filters button: it is
           how the list is shown, and it stays one press away on every width. -->
      <template #view>
        <div class="h-[42px] shrink-0 overflow-hidden rounded-lg bg-surface-container/50">
          <v-btn
            icon
            size="42"
            rounded="0"
            variant="text"
            :color="ui.hideWatched ? 'primary' : 'on-surface'"
            :aria-pressed="ui.hideWatched"
            @click="ui.hideWatched = !ui.hideWatched"
          >
            <v-icon :icon="ui.hideWatched ? mdiEyeOff : mdiEyeOutline" size="24" />
            <v-tooltip activator="parent" :text="ui.hideWatched ? $t('Show watched') : $t('Hide watched')" />
          </v-btn>
        </div>
      </template>
    </options-bar>

    <div class="min-h-0 flex-1">
      <media-layout
        :items="shown"
        :pending="pending"
        :done="done"
        :error="error"
        @load="loadMore"
      />
    </div>
  </div>
</template>
