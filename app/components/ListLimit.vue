<script setup lang="ts">
import type { TraktList } from '~/utils/trakt'

/**
 * Trakt caps its lists per account; this app doesn't cap anything. So when a
 * list here outgrows one there, nothing breaks and nothing is refused — the
 * entries past the cap simply stay on this device. That is worth saying once,
 * on the page it happened to, rather than failing a button press.
 *
 * Text only: nothing to press, so nothing for the d-pad to walk into.
 */
const props = defineProps<{ list: TraktList, count: number }>()

const trakt = useTraktStore()
const over = computed(() => trakt.over(props.list, props.count))
</script>

<template>
  <v-alert
    v-if="over"
    type="info"
    variant="tonal"
    density="compact"
    rounded="0"
    class="text-body-medium"
  >
    Trakt keeps {{ trakt.limits[list] }} items in this list on your account.
    The {{ over }} beyond that {{ over === 1 ? 'is' : 'are' }} kept here only — everything
    still works on this device.
  </v-alert>
</template>
