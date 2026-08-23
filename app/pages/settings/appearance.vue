<script setup lang="ts">
import { mdiImageOutline, mdiMonitorScreenshot, mdiPaletteOutline } from '@mdi/js'

/**
 * Appearance is three separate jobs — what colour the app is, what is behind
 * it, and how big it all is — and stacking them made one page nothing could be
 * found on. A tab keeps the theme grid the whole screen it needs.
 *
 * Each tab is a route of its own, like the sections above it, so a reload comes
 * back to the one that was open.
 */
const route = useRoute()

// The value is the path: the tab bar is really a set of links, and matching a
// route against `localePath` is what saves a second table mapping the two.
const TABS = [
  { value: '/settings/appearance', title: () => $t('Theme'), icon: mdiPaletteOutline },
  { value: '/settings/appearance/background', title: () => $t('Background'), icon: mdiImageOutline },
  { value: '/settings/appearance/display', title: () => $t('Display'), icon: mdiMonitorScreenshot },
] as const

const tab = computed({
  get: () => TABS.find(t => localePath(t.value) === route.path)?.value ?? TABS[0].value,
  set: value => navigateTo(localePath(value)),
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <v-tabs v-model="tab" inset grow color="primary">
      <v-tab v-for="t in TABS" :key="t.value" :ripple="false" :value="t.value" :prepend-icon="t.icon" :text="t.title()" />
    </v-tabs>
    <nuxt-page />
  </div>
</template>
