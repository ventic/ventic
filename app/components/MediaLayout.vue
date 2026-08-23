<script setup lang="ts">
import type { Media } from '~/utils/tmdb'
import { mdiAlertCircleOutline, mdiMovieOpenOutline, mdiRefresh } from '@mdi/js'

const props = defineProps<{
  items: Media[]
  pending: boolean
  done: boolean
  error?: string
}>()

const emit = defineEmits<{ load: [] }>()

const ui = useUiStore()
const scroller = ref<HTMLElement | null>(null)

useInfiniteScroll(scroller, () => emit('load'), {
  distance: 900,
  canLoadMore: () => !props.done && !props.pending && !props.error,
})

// A new list (filter changed, page opened) shows its own art and starts at the
// top; appending a page leaves items[0] alone, so scrolling doesn't trigger it.
watch(() => props.items[0], first => {
  if (!first)
    return
  ui.ambient(first)
  scroller.value?.scrollTo({ top: 0 })
}, { immediate: true })

// The browse pages are kept alive, so coming back from a title still has every
// page you scrolled through — but KeepAlive parks the DOM off-document, and a
// detached element loses its scrollTop. Record it as it happens; by the time
// onDeactivated runs the move has already zeroed it.
let at = 0
useEventListener(scroller, 'scroll', () => {
  at = scroller.value?.scrollTop ?? at
})
onActivated(() => scroller.value?.scrollTo({ top: at }))

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${ui.cardWidth}px, 1fr))`,
}))

// Placeholders only while the first page is in flight — later pages append below
// the existing ones, where the spinner already lives.
const loadingFirstPage = computed(() => props.pending && !props.items.length)
</script>

<template>
  <!-- pt-1: the scroller clips at its own edge, and the top row's highlight
       needs somewhere to sit. scroll-py: keeps the row the d-pad just moved to
       clear of the top and bottom edges. -->
  <div ref="scroller" data-dpad-start class="h-full scroll-py-6 overflow-y-auto px-4 pb-10 pt-1 md:px-6">
    <div v-if="ui.isGrid" class="grid gap-x-4 gap-y-5" :style="gridStyle">
      <media-card
        v-for="media in items"
        :key="`${media.type}-${media.id}`"
        :media="media"
        :detail="ui.isDetailed"
      />
      <div
        v-for="n in loadingFirstPage ? 18 : 0"
        :key="`skeleton-${n}`"
        class="animate-pulse aspect-2/3 rounded-xl bg-surface-container/60"
      />
    </div>

    <div v-else class="flex flex-col gap-0.5">
      <media-row
        v-for="media in items"
        :key="`${media.type}-${media.id}`"
        :media="media"
      />
      <div
        v-for="n in loadingFirstPage ? 12 : 0"
        :key="`skeleton-${n}`"
        class="animate-pulse h-18 rounded-xl bg-surface-container/60"
      />
    </div>

    <div class="flex flex-col items-center justify-center gap-2 py-8">
      <v-progress-circular v-if="pending && items.length" />

      <template v-else-if="error">
        <v-icon :icon="mdiAlertCircleOutline" color="error" />
        <span class="text-body-medium opacity-70">{{ error }}</span>
        <v-btn :prepend-icon="mdiRefresh" variant="tonal" size="small" @click="emit('load')">
          {{ $t('Retry') }}
        </v-btn>
      </template>

      <template v-else-if="!items.length && !pending">
        <v-icon :icon="mdiMovieOpenOutline" size="40" class="opacity-30" />
        <span class="text-body-medium opacity-70">{{ $t('Nothing here.') }}</span>
      </template>

      <span v-else-if="done" class="text-body-small opacity-45">{{ $t('That\'s everything.') }}</span>
    </div>
  </div>
</template>
