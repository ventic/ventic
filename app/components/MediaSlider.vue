<script setup lang="ts">
import type { FeedRequest } from '~/composables/useMediaFeed'

const props = defineProps<{ title: string, request: FeedRequest }>()

const ui = useUiStore()

const { items, pending, done, loadMore } = useMediaFeed(() => props.request)
</script>

<template>
  <scroll-row :title="title" :can-load="!done && !pending" @end="loadMore">
    <media-card
      v-for="media in items"
      :key="`${media.type}-${media.id}`"
      :media="media"
      :detail="ui.isDetailed"
      class="shrink-0"
      :style="{ width: `${ui.cardWidth}px` }"
    />
    <div
      v-for="n in pending && !items.length ? 8 : 0"
      :key="`skeleton-${n}`"
      class="animate-pulse aspect-2/3 shrink-0 rounded-xl bg-surface-container/60"
      :style="{ width: `${ui.cardWidth}px` }"
    />
    <div
      v-if="pending && items.length"
      class="grid shrink-0 place-items-center"
      :style="{ width: `${ui.cardWidth}px` }"
    >
      <v-progress-circular />
    </div>
  </scroll-row>
</template>
