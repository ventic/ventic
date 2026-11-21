<script setup lang="ts">
import type { FeedRequest } from '~/composables/useMediaFeed'
import { mdiMagnify } from '@mdi/js'

definePageMeta({ keepalive: true })

const route = useRoute()

const query = computed(() => ((route.query.q as string) ?? '').trim())

const scopes = computed(() => [
  { value: 'multi', title: $t('All') },
  { value: 'movie', title: $t('Movies') },
  { value: 'tv', title: $t('TV Shows') },
  { value: 'anime', title: $t('Anime') },
])

const scope = ref('multi')

const request = computed<FeedRequest | null>(() => {
  if (!query.value)
    return null

  // Anime is the app's bucket, not TMDB's: search has no language or genre
  // filter, so it is every film and show the query finds, narrowed to what the
  // Anime page would list. A short page is no problem — the grid pulls the next
  // until it fills or runs out, exactly as a genre on Trending does.
  const anime = scope.value === 'anime'
  return {
    path: `/search/${anime ? 'multi' : scope.value}`,
    type: scope.value === 'movie' || scope.value === 'tv' ? scope.value : undefined,
    keepKind: anime ? 'anime' : undefined,
    params: {
      query: query.value,
      include_adult: false,
    },
  }
})

const { items, pending, error, done, loadMore } = useMediaFeed(request)
</script>

<template>
  <div class="flex h-full flex-col">
    <options-bar>
      <div class="flex min-w-0 items-center gap-3">
        <v-btn-toggle
          v-model="scope"
          mandatory
          density="compact"
          variant="text"
          color="primary"
          class="shrink-0 rounded-full bg-surface-container/50"
        >
          <v-btn v-for="option in scopes" :key="option.value" :value="option.value" size="small">
            {{ option.title }}
          </v-btn>
        </v-btn-toggle>

        <!-- The phone's toolbar is the search box, so the query is already on
             screen there; this is for the desktop bar, where it isn't obvious
             which search these results belong to. -->
        <span v-if="query" class="hidden truncate text-body-small opacity-60 md:inline">
          {{ $t('Results for “{query}”', { query }) }}
        </span>
      </div>
    </options-bar>

    <div v-if="!query" class="flex flex-1 flex-col items-center justify-center gap-2 opacity-60">
      <v-icon :icon="mdiMagnify" size="40" />
      <span class="text-body-medium">{{ $t('Type in the search box to find movies and shows.') }}</span>
    </div>

    <div v-else class="min-h-0 flex-1">
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
