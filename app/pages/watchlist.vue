<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <library-browser :title="$t('Watchlist')" :items="library.watchlistItems" :recent="$t('Recently added')" />
</template>
