<script setup lang="ts">
import { mdiArrowLeft } from '@mdi/js'

// Desktop only: a phone lists the sections as a page instead
// (pages/settings/index.vue), so there is no overlay here to open or close.
</script>

<template>
  <v-navigation-drawer
    :width="228"
    permanent
    class="panel border-none"
  >
    <nuxt-link :to="localePath('/')" class="flex items-center gap-3 px-4 py-5">
      <v-icon :icon="mdiArrowLeft" size="22" />
      <span class="text-title-medium whitespace-nowrap">{{ $t('Settings') }}</span>
    </nuxt-link>

    <v-list nav density="comfortable" class="px-2">
      <v-list-item
        v-for="item in SECTIONS"
        :key="item.value"
        :to="localePath(`/settings/${item.value}`)"
        :prepend-icon="item.icon"
        :title="item.title()"
        color="primary"
        rounded="lg"
      />
    </v-list>
  </v-navigation-drawer>
</template>
