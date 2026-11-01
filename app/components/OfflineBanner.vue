<script setup lang="ts">
import { mdiCloudOffOutline } from '@mdi/js'

// Read here: a template doesn't unwrap a ref it got from an auto-import.
const offline = computed(() => !online.value)
</script>

<template>
  <!-- Said once, for every page: what each one shows instead is its own
       business (Movies, Shows and Home list what is on this device). Nothing
       here takes focus, so a remote walks straight past it. -->
  <v-alert
    v-if="offline"
    class="mx-4 mb-2 flex-none md:mx-6"
    type="info"
    variant="tonal"
    density="compact"
    rounded="lg"
    :icon="mdiCloudOffOutline"
    :text="$t('You\'re offline, so Ventic is showing what\'s on this device. Downloads play, with the subtitles they were downloaded with.')"
  />
</template>
