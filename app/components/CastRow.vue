<script setup lang="ts">
import type { Person } from '~/utils/tmdb'
import { mdiAccountOutline } from '@mdi/js'

defineProps<{ title: string, people: Person[] }>()

const ui = useUiStore()

// Same bargain as MediaCard's, and the same rule about where it goes: the
// containment sits on the element the hover zoom is already on, so nothing
// inside it is re-decided while it animates. A cast row is 20 faces the page
// never scrolls to on a TV.
const reserve = computed(() => `${ui.castWidth}px ${Math.round(ui.castWidth * 1.5)}px`)
</script>

<template>
  <scroll-row :title="title">
    <nuxt-link
      v-for="person in people"
      :key="person.id"
      :to="personLink(person.id)"
      class="group block shrink-0 select-none outline-none"
      :style="{ width: `${ui.castWidth}px` }"
    >
      <!-- Same 2:3 frame as a poster card — profileUrl's w185 is 185x278.
           object-top: a headshot is framed at the top, and a 2:3 crop of a
           portrait otherwise takes the chin off. -->
      <div class="relative aspect-2/3 overflow-hidden rounded-xl bg-surface-container [&_img]:object-top">
        <media-poster
          :src="profileUrl(person.profile, ui.profileSize)"
          :alt="person.name"
          :icon="mdiAccountOutline"
          class="transition-transform duration-500 group-hover:scale-105 [content-visibility:auto]"
          :style="{ containIntrinsicSize: reserve }"
        />
        <!-- Drawn inside the frame, like a card's: the row is a scroller and
             clips anything outside it, so the first face would lose its ring. -->
        <div class="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-inset ring-primary transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
      <div class="truncate pt-2 text-label-medium" :title="person.name">
        {{ person.name }}
      </div>
      <div class="line-clamp-2 text-label-small opacity-55" :title="person.role">
        {{ person.role }}
      </div>
    </nuxt-link>
  </scroll-row>
</template>
