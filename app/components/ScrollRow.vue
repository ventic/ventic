<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js'

/**
 * A titled horizontal strip. The arrows are the only way to reach the end of
 * one: the scrollbar is hidden and a wheel scrolls the page, not the row.
 */
const props = defineProps<{ title: string, canLoad?: boolean }>()

const emit = defineEmits<{ end: [] }>()

const scroller = ref<HTMLElement | null>(null)
const { arrivedState } = useScroll(scroller)

useInfiniteScroll(scroller, () => emit('end'), {
  distance: 600,
  direction: 'right',
  canLoadMore: () => props.canLoad === true,
})

// Paging by a fraction of the width lands mid-card, which CSS scroll-snap then
// undoes with a second animation — the row visibly jerks back. Stepping whole
// cards lands where snap already wants to be, so there's nothing to correct.
function page(direction: 1 | -1) {
  const el = scroller.value
  if (!el)
    return

  const gap = 16 // gap-4
  const card = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth
  const cards = Math.max(1, Math.floor(el.clientWidth / (card + gap)))
  el.scrollBy({ left: direction * cards * (card + gap), behavior: 'smooth' })
}
</script>

<template>
  <section class="group/row">
    <div class="flex items-center gap-2 px-4 md:px-6">
      <h2 class="text-title-large">
        {{ title }}
      </h2>
      <v-spacer />
      <!-- Shown while anything in the row has focus too, so a remote can see how
           far the row goes. tabindex="-1" keeps them out of the d-pad's way:
           arrowing along the row already scrolls it. -->
      <div class="flex gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" :disabled="arrivedState.left" @click="page(-1)">
          <v-icon :icon="mdiChevronLeft" />
        </v-btn>
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" :disabled="arrivedState.right" @click="page(1)">
          <v-icon :icon="mdiChevronRight" />
        </v-btn>
      </div>
    </div>

    <!-- scroll-px: keeps the focused card off the edge when the d-pad scrolls
         the row to it. -->
    <div ref="scroller" class="flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 pt-2 md:scroll-px-6 md:px-6 no-scrollbar">
      <slot />
    </div>
  </section>
</template>
