<script setup lang="ts">
const library = useLibraryStore()
</script>

<template>
  <library-browser :title="$t('Favourites')" :items="library.favouriteList" :recent="$t('Recently added')" />
</template>
