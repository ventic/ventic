<script setup lang="ts">
import { mdiBookmarkOutline } from '@mdi/js'

const library = useLibraryStore()
</script>

<template>
  <library-browser
    :title="$t('Watchlist')"
    :items="library.watchlistItems"
    :recent="$t('Recently added')"
    :empty="{
      icon: mdiBookmarkOutline,
      title: $t('Nothing on your watchlist'),
      text: $t('Bookmark a film or a show to keep it for later.'),
    }"
  />
</template>
