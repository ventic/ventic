<script setup lang="ts">
/**
 * A named control. A slider with its name beside it reads across a room, which
 * the icons these used to carry did not.
 */
defineProps<{ label: string }>()
</script>

<template>
  <div class="flex items-center gap-4">
    <span class="text-body-medium w-28 shrink-0">{{ label }}</span>
    <div class="min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>
