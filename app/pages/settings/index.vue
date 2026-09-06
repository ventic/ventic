<script setup lang="ts">
import { mdiChevronRight } from '@mdi/js'

/**
 * `/settings` is the shell, not a page — from `md` up the sidebar lists the
 * sections and the first one is what opening settings means, so this redirects
 * rather than rendering Appearance a second time under a second URL.
 *
 * A phone has no sidebar: there this *is* the list, the way every phone's
 * settings opens, and Back from a section returns here (see settings.vue).
 */
definePageMeta({
  middleware: () => {
    if (!useNuxtApp().$vuetify.display.mobile.value)
      return navigateTo(localePath('/settings/appearance'), { replace: true })
  },
})
</script>

<template>
  <v-list nav class="bg-transparent px-0">
    <v-list-item
      v-for="item in SECTIONS"
      :key="item.value"
      :to="localePath(`/settings/${item.value}`)"
      :prepend-icon="item.icon"
      :title="item.title()"
      :append-icon="mdiChevronRight"
      rounded="lg"
      class="mb-1 bg-surface-container/40"
    />
  </v-list>
</template>
