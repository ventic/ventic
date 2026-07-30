<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <div class="flex h-full flex-col">
    <options-bar>
      <h1 class="text-title-large">
        Watchlist
      </h1>
    </options-bar>

    <list-limit list="watchlist" :count="library.watchlistItems.length" />

    <!-- Everything is already in localStorage, so there is nothing to page in:
         the layout's loading and error states never fire here. -->
    <div class="min-h-0 flex-1">
      <media-layout :items="library.watchlistItems" :pending="false" done />
    </div>
  </div>
</template>
