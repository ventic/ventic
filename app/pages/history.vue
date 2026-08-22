<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <!-- One entry per title rather than per episode — a show you are ten episodes
       into should take up one card, not ten. -->
  <library-browser title="History" :items="library.history" recent="Last watched" />
</template>
