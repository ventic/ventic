<script setup lang="ts">
/**
 * `/settings` is the shell, not a page — the first section is what opening
 * settings means. A redirect rather than Appearance rendered here as well,
 * so every section has exactly one URL.
 */
definePageMeta({
  middleware: () => navigateTo(localePath('/settings/appearance'), { replace: true }),
})
</script>

<template>
  <div />
</template>
