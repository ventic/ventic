<script setup lang="ts">
import { mdiMagnify } from '@mdi/js'

definePageMeta({ keepalive: true })

const route = useRoute()

const query = computed(() => ((route.query.q as string) ?? '').trim())

const scopes = computed(() => [
  { value: 'multi', title: $t('All') },
  { value: 'movie', title: $t('Movies') },
  { value: 'tv', title: $t('TV Shows') },
])

const scope = ref('multi')

const request = computed(() => {
  if (!query.value)
    return null

  return {
    path: `/search/${scope.value}`,
    type: scope.value === 'multi' ? undefined : scope.value as 'movie' | 'tv',
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
          class="shrink-0 rounded-lg bg-surface-container/50"
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
