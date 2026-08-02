<script setup lang="ts">
/** One titled block on the settings page. Every section, one shape. */
defineProps<{ title: string, hint?: string }>()
</script>

<template>
  <section class="flex flex-col gap-3">
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
