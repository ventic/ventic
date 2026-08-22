<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <library-browser title="Favourites" :items="library.favouriteList" recent="Recently added" />
</template>
