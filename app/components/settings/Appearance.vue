<script setup lang="ts">
import { mdiImageOutline, mdiMonitorScreenshot, mdiPaletteOutline } from '@mdi/js'

/**
 * Appearance is three separate jobs — what colour the app is, what is behind
 * it, and how big it all is — and stacking them made one page nothing could be
 * found on. A tab keeps the theme grid the whole screen it needs.
 *
 * Not persisted and not a route: Back should leave settings rather than walk
 * back through the tabs opened on the way in.
 */
const tab = ref<'theme' | 'background' | 'display'>('theme')

const TABS = [
  { value: 'theme', title: () => $t('Theme'), icon: mdiPaletteOutline },
  { value: 'background', title: () => $t('Background'), icon: mdiImageOutline },
  { value: 'display', title: () => $t('Display'), icon: mdiMonitorScreenshot },
] as const
</script>

<template>
  <div class="flex flex-col gap-6">
    <settings-segment v-model="tab" :options="TABS" />

    <settings-appearance-theme v-if="tab === 'theme'" />
    <settings-appearance-background v-else-if="tab === 'background'" />
    <settings-appearance-display v-else />
  </div>
</template>
