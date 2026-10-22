<script setup lang="ts">
import { mdiHeartOutline } from '@mdi/js'

const library = useLibraryStore()
</script>

<template>
  <library-browser
    :title="$t('Favourites')"
    :items="library.favouriteList"
    :recent="$t('Recently added')"
    :empty="{
      icon: mdiHeartOutline,
      title: $t('No favourites yet'),
      text: $t('Press the heart on a film or a show and it is kept here.'),
    }"
  />
</template>
