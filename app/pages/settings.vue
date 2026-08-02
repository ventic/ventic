<script setup lang="ts">
import { mdiArrowLeft, mdiMenu } from '@mdi/js'

definePageMeta({ layout: 'settings' })

const ui = useUiStore()
const settings = useSettingsStore()
const { mobile } = useDisplay()

const title = computed(() => SECTIONS.find(s => s.value === settings.section)?.title ?? '')
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-3xl px-4 pb-16 md:px-8">
      <div class="flex items-center gap-2 pb-5 pt-3">
        <!-- Always-on way out of the settings shell — on a phone the menu button
             beside it only switches sections, so this is the only exit there. -->
        <v-btn icon variant="text" color="on-surface" to="/">
          <v-icon :icon="mdiArrowLeft" />
          <v-tooltip activator="parent" text="Back" />
        </v-btn>
        <v-btn v-if="mobile" :icon="mdiMenu" variant="text" color="on-surface" @click="ui.drawer = true" />
        <h1 class="text-headline-medium font-bold">
          {{ title }}
        </h1>
      </div>

      <settings-appearance v-if="settings.section === 'appearance'" />
      <settings-sources v-else-if="settings.section === 'sources'" />
      <settings-subtitles v-else-if="settings.section === 'subtitles'" />
      <settings-network v-else-if="settings.section === 'network'" />
      <settings-storage v-else-if="settings.section === 'storage'" />
      <settings-account v-else-if="settings.section === 'account'" />
      <settings-about v-else-if="settings.section === 'about'" />
    </div>
  </div>
</template>
