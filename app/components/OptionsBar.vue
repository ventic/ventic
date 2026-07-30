<script setup lang="ts">
import { mdiImageSizeSelectSmall, mdiTune } from '@mdi/js'

/**
 * The strip above a browse list: what to show on the left, how to show it on
 * the right.
 *
 * Two slots, because a desktop has room for all of it and a phone has room for
 * one line. The default slot stays on the bar at every width and is expected to
 * scroll itself rather than wrap. Everything in `#filters` is inline on a wide
 * window and moves into a sheet behind one button on a narrow one — three
 * wrapped rows of dropdowns were eating a third of the screen before the first
 * poster.
 */
defineProps<{
  /** How many filters are set, shown on the button so a narrowed list says so. */
  active?: number
}>()

const ui = useUiStore()
const { mobile } = useDisplay()

const sheet = ref(false)
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 px-4 pb-3 md:px-6">
    <!-- min-w-0 + flex-1 is what makes the chip group inside scroll rather than
         push everything else off the bar; a wide window has room for the lot, so
         it goes back to sizing itself and the filters sit beside it as before. -->
    <div class="min-w-0 flex-1 md:flex-none">
      <slot />
    </div>

    <template v-if="!mobile">
      <slot name="filters" />
      <v-spacer />

      <!-- The wrapper does the hiding: v-input is display:grid internally, and a
           `md:flex` on it collapses the slider track to zero width. -->
      <div v-if="ui.isGrid" class="hidden w-40 shrink-0 md:block">
        <v-slider
          v-model="ui.cardWidth"
          :min="110"
          :max="300"
          :step="10"
          :prepend-icon="mdiImageSizeSelectSmall"
          title="Poster size"
        />
      </div>
    </template>

    <!-- Narrow: one button for the lot. The count is there because a filter left
         on from last time is otherwise invisible once the sheet is shut. -->
    <v-btn
      v-else-if="$slots.filters"
      :prepend-icon="mdiTune"
      variant="text"
      color="on-surface"
      size="small"
      class="shrink-0"
      @click="sheet = true"
    >
      Filters
      <v-chip v-if="active" size="x-small" color="primary" class="ml-1.5" :text="String(active)" />
    </v-btn>

    <v-btn-toggle
      v-model="ui.layout"
      mandatory
      variant="text"
      color="primary"
      class="h-[42px] shrink-0 rounded-lg bg-surface-container/50"
    >
      <v-btn v-for="option in LAYOUTS" :key="option.value" :value="option.value" size="42" icon>
        <v-icon :icon="option.icon" size="24" />
        <v-tooltip activator="parent" :text="option.title" />
      </v-btn>
    </v-btn-toggle>
  </div>

  <!-- A sheet off the bottom rather than a centred dialog: it arrives under the
       thumb, which is what a filter button does on a phone. The slot is only
       ever rendered on one side of the `mobile` branch above, so nothing is
       mounted twice. -->
  <v-bottom-sheet v-model="sheet">
    <v-card rounded="t-xl" class="pb-[var(--safe-bottom)]">
      <v-card-title class="text-title-medium">
        Filters
      </v-card-title>
      <v-card-text class="flex flex-col gap-5 pt-2">
        <slot name="filters" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="tonal" @click="sheet = false">
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-bottom-sheet>
</template>
