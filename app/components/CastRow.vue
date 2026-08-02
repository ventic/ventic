<script setup lang="ts">
import type { Person } from '~/utils/tmdb'

defineProps<{ title: string, people: Person[] }>()
</script>

<template>
  <scroll-row :title="title">
    <div v-for="person in people" :key="person.id" class="w-28 shrink-0">
      <!-- Same 2:3 frame as a poster card — profileUrl's w185 is 185x278. -->
      <div class="aspect-2/3 overflow-hidden rounded-xl bg-surface-container [&_img]:object-top">
        <media-poster :src="profileUrl(person.profile)" :alt="person.name" />
      </div>
      <div class="truncate pt-2 text-label-medium" :title="person.name">
        {{ person.name }}
      </div>
      <div class="line-clamp-2 text-label-small opacity-55" :title="person.role">
        {{ person.role }}
      </div>
    </div>
  </scroll-row>
</template>
