<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <library-browser title="Watchlist" :items="library.watchlistItems" recent="Recently added" />
</template>
