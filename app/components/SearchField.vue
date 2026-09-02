<script setup lang="ts">
import { mdiMagnify } from '@mdi/js'

/**
 * The app bar's search box. Everything about parking it out of a remote's way
 * lives in `TvField` — this is that, with a magnifier in it.
 */
defineProps<{
  placeholder: string
  density?: 'default' | 'compact'
}>()

const emit = defineEmits<{ enter: [] }>()

const query = defineModel<string>({ required: true })
</script>

<template>
  <tv-field :label="placeholder">
    <v-text-field
      :model-value="query"
      :prepend-inner-icon="mdiMagnify"
      :placeholder="placeholder"
      :density="density ?? 'compact'"
      variant="solo-filled"
      rounded="lg"
      flat
      hide-details
      clearable
      @keydown.enter="emit('enter')"
      @update:model-value="query = $event ?? ''"
    />
  </tv-field>
</template>
