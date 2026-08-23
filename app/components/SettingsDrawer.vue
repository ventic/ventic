<script setup lang="ts">
import { mdiArrowLeft } from '@mdi/js'

const ui = useUiStore()
const route = useRoute()
const { mobile } = useDisplay()

const open = computed({
  get: () => !mobile.value || ui.drawer,
  set: value => (ui.drawer = value),
})

// Picking a section on mobile should get the overlay out of the way.
watch(() => route.path, () => {
  if (mobile.value)
    ui.drawer = false
})
</script>

<template>
  <v-navigation-drawer
    v-model="open"
    :width="228"
    :permanent="!mobile"
    :temporary="mobile"
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
