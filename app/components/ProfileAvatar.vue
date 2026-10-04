<script setup lang="ts">
import type { Profile } from '~/utils/profiles'
import { mdiShieldAccount } from '@mdi/js'

/**
 * A profile's face: its initial on its colour, readable across a room with no
 * picture to load — and a shield on a child's, so a parent can tell at a glance
 * which profiles are locked.
 */
const props = withDefaults(defineProps<{ profile: Profile, size?: number }>(), { size: 40 })

// Spread rather than indexed, so a name that starts outside the BMP keeps its
// whole first character.
const initial = computed(() => [...profileName(props.profile)][0]?.toLocaleUpperCase() ?? '')

// The shield grows with the face, and its centre sits on the circle's edge at
// 45° rather than on the box's corner — which, on a 104px tile, is 15px clear
// of the circle. A badge hangs 12px over its box by default.
const badge = computed(() => Math.max(16, Math.round(props.size * 0.34)))
const offset = computed(() => Math.round(props.size * (1 - Math.SQRT1_2) / 2 + badge.value / 2 - 12))
</script>

<template>
  <v-badge
    :model-value="!!profile.kids"
    color="primary"
    location="bottom end"
    rounded="50%"
    bordered
    :width="badge"
    :height="badge"
    :offset-x="offset"
    :offset-y="offset"
  >
    <template #badge>
      <v-icon :icon="mdiShieldAccount" :size="Math.round(badge * 0.66)" />
    </template>
    <v-avatar :color="profile.colour" :size="size" class="font-bold text-white" :style="{ fontSize: `${Math.round(size * 0.44)}px` }" aria-hidden="true">
      {{ initial }}
    </v-avatar>
  </v-badge>
</template>
