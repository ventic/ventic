<script setup lang="ts">
import { mdiHistory } from '@mdi/js'

// library.history is one entry per title rather than per episode — a show you
// are ten episodes into should take up one card, not ten.
const library = useLibraryStore()
</script>

<template>
  <library-browser
    :title="$t('History')"
    :items="library.history"
    :recent="$t('Last watched')"
    :empty="{
      icon: mdiHistory,
      title: $t('Nothing watched yet'),
      text: $t('Whatever you play is listed here, with how far you got.'),
    }"
  />
</template>
