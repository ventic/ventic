<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js'

/**
 * A titled horizontal strip. The arrows page it; a wheel with Shift held, or a
 * trackpad sideways, scrolls it natively — there is no scrollbar to grab.
 */
const props = defineProps<{ title: string, canLoad?: boolean }>()

const emit = defineEmits<{ end: [] }>()

const scroller = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)

const atStart = ref(true)
const atEnd = ref(true)
const overflows = ref(false)

/**
 * Where the row is sitting. Measured here rather than by `useScroll`, which
 * looks on mount and on scroll and nothing else: a row is empty when it mounts,
 * so both arrows came up disabled and stayed that way until it was dragged by
 * hand. The observer on the track is what notices the cards arriving — and the
 * poster size changing, which moves the ends just as much.
 */
function measure() {
  const el = scroller.value
  if (!el)
    return
  const max = el.scrollWidth - el.clientWidth
  overflows.value = max > 1
  atStart.value = el.scrollLeft < 1
  atEnd.value = el.scrollLeft > max - 1
}

useResizeObserver([scroller, track], measure)

/**
 * A row that is moving belongs to nobody's pointer. Cards passing under a
 * stationary cursor fire an enter and a leave each, and every one of those
 * mounts the hover overlay's dozen components, moves the backdrop and takes the
 * card out of `content-visibility` — a whole row of that for one flick of the
 * wheel, which is what the flicker and the stutter were.
 *
 * The class goes on the track and not on the scroller: a scroller that ignores
 * the pointer never sees the wheel either, and the page would scroll instead.
 */
const gliding = ref(false)
const settle = useDebounceFn(() => (gliding.value = false), 140)

useEventListener(scroller, 'scroll', () => {
  measure()
  gliding.value = true
  settle()
}, { passive: true })

useInfiniteScroll(scroller, () => emit('end'), {
  distance: 600,
  direction: 'right',
  canLoadMore: () => props.canLoad === true,
})

// Paging by a fraction of the width leaves a sliver of a poster at each edge and
// the next press compounds it. Whole cards land where the row started: the step
// is a multiple of the pitch, so every stop insets a card by the track's own
// padding, exactly as the first one is.
function page(direction: 1 | -1) {
  const el = scroller.value
  if (!el)
    return

  const gap = 16 // gap-4
  const card = (track.value?.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth
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
      <div v-if="overflows" class="flex gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" :disabled="atStart" @click="page(-1)">
          <v-icon :icon="mdiChevronLeft" />
        </v-btn>
        <v-btn icon size="small" variant="text" color="on-surface" tabindex="-1" :disabled="atEnd" @click="page(1)">
          <v-icon :icon="mdiChevronRight" />
        </v-btn>
      </div>
    </div>

    <!-- No scroll-snap. It re-animates after every wheel notch and again each
         time a page of cards is appended mid-scroll, which is the jerk you feel
         holding Shift — and `page()` already lands where snap wanted to be.
         scroll-px: keeps the focused card off the edge when the d-pad scrolls
         the row to it. overscroll-x-contain: reaching the end of a row must not
         hand the rest of the gesture to the page behind it. -->
    <div ref="scroller" class="overflow-x-auto scroll-px-4 overscroll-x-contain md:scroll-px-6 no-scrollbar">
      <div ref="track" class="w-max flex gap-4 px-4 pb-1 pt-2 md:px-6" :class="{ 'pointer-events-none': gliding }">
        <slot />
      </div>
    </div>
  </section>
</template>
