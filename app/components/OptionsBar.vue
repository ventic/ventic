<script setup lang="ts">
import { mdiImageSizeSelectSmall, mdiTune } from '@mdi/js'

/**
 * The strip above a browse list: what to show on the left, how to show it on
 * the right.
 *
 * Two slots, because a wide row has space for all of it and a narrow one has
 * space for one line. The default slot stays on the bar at every width and is
 * expected to scroll itself rather than wrap. Everything in `#filters` is inline
 * while it fits and moves into a sheet behind one button when it doesn't — three
 * wrapped rows of dropdowns were eating a third of the screen before the first
 * poster.
 */
const props = defineProps<{
  /** How many filters are set, shown on the button so a narrowed list says so. */
  active?: number
  /**
   * The width this bar's controls want, in px: everything in `#filters` plus
   * the left slot, the poster slider (160) and the layout toggle (84), plus 8
   * per gap. Below it the filters go behind the button. Measure it — the
   * numbers are small and the guesses are not.
   *
   * A number rather than a breakpoint because the window is not the row: a
   * permanent sidebar takes 236px off it, a collapsed rail 56 — so one window
   * is two very different amounts of space. At md this bar is 676px wide and
   * was being asked to hold 692px of browse controls.
   */
  needs?: number
}>()

const ui = useUiStore()
const { mobile } = useDisplay()

const sheet = ref(false)

const bar = useTemplateRef('bar')
const { width } = useElementSize(bar)

// `mobile` stands in until the observer has measured, which is what this
// decision used to be made on — otherwise a phone paints one frame of inline
// dropdowns on the way to hiding them.
const roomy = computed(() => width.value ? width.value >= (props.needs ?? 740) : !mobile.value)
</script>

<template>
  <div ref="bar" class="flex shrink-0 items-center gap-2 px-4 pb-3 md:px-6">
    <!-- min-w-0 + flex-1 is what makes the chip group inside scroll rather than
         push everything else off the bar; a wide window has room for the lot, so
         it goes back to sizing itself and the filters sit beside it as before. -->
    <div class="min-w-0 flex-1 md:flex-none">
      <slot />
    </div>

    <slot v-if="roomy" name="filters" />

    <!-- No room: one button for the lot. The count is there because a filter
         left on from last time is otherwise invisible once the sheet is shut. -->
    <v-btn
      v-else-if="$slots.filters"
      :prepend-icon="mdiTune"
      variant="text"
      color="on-surface"
      size="small"
      class="shrink-0"
      @click="sheet = true"
    >
      {{ $t('Filters') }}
      <v-chip v-if="active" size="x-small" color="primary" class="ml-1.5" :text="String(active)" />
    </v-btn>

    <!-- Not on a phone, where the left slot's flex-1 has already taken the slack. -->
    <v-spacer v-if="!mobile" />

    <!-- The wrapper does the hiding: v-input is display:grid internally, and a
         `md:flex` on it collapses the slider track to zero width. It stays on
         the bar whether or not the filters did — it is 160px and the button it
         would sit behind says "Filters", which a poster size is not. -->
    <div v-if="ui.isGrid" class="hidden w-40 shrink-0 md:block">
      <v-slider
        v-model="ui.cardWidth"
        :min="110"
        :max="300"
        :step="10"
        :prepend-icon="mdiImageSizeSelectSmall"
        :title="$t('Poster size')"
      />
    </div>

    <v-btn-toggle
      v-model="ui.layout"
      mandatory
      variant="text"
      color="primary"
      class="h-[42px] shrink-0 rounded-lg bg-surface-container/50"
    >
      <v-btn v-for="option in LAYOUTS" :key="option.value" :value="option.value" size="42" icon>
        <v-icon :icon="option.icon" size="24" />
        <v-tooltip activator="parent" :text="option.title()" />
      </v-btn>
    </v-btn-toggle>
  </div>

  <!-- A sheet off the bottom rather than a centred dialog: it arrives under the
       thumb, which is what a filter button does on a phone. The slot is only
       ever rendered on one side of the `roomy` branch above, so nothing is
       mounted twice. -->
  <v-bottom-sheet v-model="sheet">
    <!-- Capped and centred: the sheet is as wide as the window, and this is now
         opened on a desktop as readily as on a phone — 560px of controls spread
         across 1200 reads as a mistake. A phone is narrower than the cap and so
         is unchanged. -->
    <v-card rounded="t-xl" class="mx-auto w-full max-w-140 pb-[var(--safe-bottom)]">
      <v-card-title class="text-title-medium">
        {{ $t('Filters') }}
      </v-card-title>
      <!-- The widths a caller puts on a control are the *bar's* — a 160px
           dropdown in a column is neither one thing nor the other, so in here
           every control takes the row. -->
      <v-card-text class="flex flex-col gap-5 pt-2 [&>*]:w-full!">
        <slot v-if="!roomy" name="filters" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="tonal" @click="sheet = false">
          {{ $t('Done') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-bottom-sheet>
</template>
