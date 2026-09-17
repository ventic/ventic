<script setup lang="ts">
/** One titled block on the settings page. Every section, one shape. */
defineProps<{
  title: string
  hint?: string
  /**
   * Words the section is found by that it never says itself ("dark mode",
   * "hotkeys"). Never drawn: the settings search reads it from the page's
   * source (utils/settings-search.ts), like everything else in the section.
   */
  keywords?: string
}>()
</script>

<template>
  <section class="flex flex-col scroll-mt-6 gap-3">
    <div>
      <h2 class="text-title-medium">
        {{ title }}
      </h2>
      <p v-if="hint" class="text-body-small opacity-70">
        {{ hint }}
      </p>
    </div>
    <slot />
  </section>
</template>

<style scoped>
/* Where a search result landed (pages/settings.vue), for two seconds. An
   outline rather than a fill: it keeps off the text, moves nothing, and has
   nothing to animate on a television. */
.found {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 12px;
  border-radius: 12px;
}
</style>
