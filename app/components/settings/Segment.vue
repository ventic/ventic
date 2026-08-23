<script setup lang="ts" generic="T extends string">
/**
 * A row of mutually exclusive choices — the settings page's tabs, the
 * background modes, the theme filter.
 *
 * Plain buttons rather than `v-btn-toggle`, which marks its choice with a 12%
 * tint of the accent: under this red that is 4.49:1 against its own label and
 * reads as barely-pressed across a room, and overriding it fights Vuetify's own
 * `text-primary`. Real buttons are also what a d-pad can walk along.
 */
defineProps<{
  /**
   * `title` is a function, not a string: every options table in the app is
   * built when its module loads, before `$t` has a locale — see SECTIONS in
   * the settings store.
   */
  options: readonly { value: T, title: () => string, icon?: string }[]
  /** Sized to its labels rather than the page — a filter under a heading, not a tab bar. */
  inline?: boolean
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div
    class="flex gap-1 rounded-xl bg-surface-container-low/60 p-1"
    :class="inline ? 'self-start' : 'w-full'"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="flex items-center justify-center gap-2 border-none rounded-lg px-4 py-2 text-label-large transition-colors duration-120"
      :class="[
        inline ? '' : 'flex-1',
        model === option.value
          ? 'bg-primary text-on-primary font-medium'
          : 'bg-transparent text-on-surface hover:bg-surface-container-high focus-visible:bg-surface-container-high',
      ]"
      :aria-pressed="model === option.value"
      @click="model = option.value"
    >
      <v-icon v-if="option.icon" :icon="option.icon" size="20" />
      {{ option.title() }}
    </button>
  </div>
</template>
