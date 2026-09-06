<script setup lang="ts">
// library.history is one entry per title rather than per episode — a show you
// are ten episodes into should take up one card, not ten.
const library = useLibraryStore()
</script>

<template>
  <library-browser :title="$t('History')" :items="library.history" :recent="$t('Last watched')" />
</template>
