<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <div class="flex h-full flex-col">
    <options-bar>
      <h1 class="text-title-large">
        History
      </h1>
    </options-bar>

    <!-- Newest first, one entry per title rather than per episode — a show you
         are ten episodes into should take up one card, not ten. -->
    <div class="min-h-0 flex-1">
      <media-layout :items="library.history" :pending="false" done />
    </div>
  </div>
</template>
