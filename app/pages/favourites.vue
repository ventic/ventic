<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <div class="flex h-full flex-col">
    <options-bar>
      <h1 class="text-title-large">
        Favourites
      </h1>
    </options-bar>

    <list-limit list="favorites" :count="library.favouriteList.length" />

    <!-- Everything is already in localStorage, so there is nothing to page in:
         the layout's loading and error states never fire here. -->
    <div class="min-h-0 flex-1">
      <media-layout :items="library.favouriteList" :pending="false" done />
    </div>
  </div>
</template>
