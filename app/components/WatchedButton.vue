<script setup lang="ts">
import type { Media } from '~/utils/tmdb'
import { mdiEye, mdiEyeOutline } from '@mdi/js'

// Two roots (the button and its dialog), so class/size from the caller has to
// be placed by hand rather than falling through.
defineOptions({ inheritAttrs: false })

// `show` only feeds the card snapshot History renders from — it is null for the
// moment the detail request is still in flight, and the mark works without it.
const props = defineProps<{
  showId: string
  season: number
  episode: number
  show?: Media | null
  size?: string
}>()

const library = useLibraryStore()

const watched = computed(() => library.episodeProgress(props.showId, props.season, props.episode)?.watched ?? false)

const target = () => props.show ?? { id: Number(props.showId), type: 'tv' as const }

// This season only. Nothing here knows how long the seasons before it
// were, and "earlier" reads as the episodes listed above this one anyway.
const earlier = computed(() => {
  const numbers: number[] = []
  for (let n = 1; n < props.episode; n++) {
    if (!library.episodeProgress(props.showId, props.season, n)?.watched)
      numbers.push(n)
  }
  return numbers
})

const asking = ref(false)

function toggle() {
  library.toggleWatched(target(), props.season, props.episode)
  // Only on the way in, and only when something is behind it: jumping straight
  // to E5 usually means the four before it were watched somewhere else.
  if (watched.value && earlier.value.length)
    asking.value = true
}

function markEarlier() {
  for (const n of earlier.value)
    library.setWatched(target(), true, props.season, n)
  asking.value = false
}
</script>

<template>
  <!-- stop/prevent: in an episode row this sits inside the link to the episode. -->
  <v-btn
    v-bind="$attrs"
    icon
    variant="text"
    color="on-surface"
    :size="size"
    @click.stop.prevent="toggle"
  >
    <v-icon :icon="watched ? mdiEye : mdiEyeOutline" :color="watched ? 'primary' : undefined" />
    <v-tooltip activator="parent" :text="watched ? $t('Mark unwatched') : $t('Mark watched')" />
  </v-btn>

  <v-dialog v-model="asking" max-width="420">
    <v-card>
      <v-card-title class="text-title-medium">
        {{ $t('Mark the earlier ones too?') }}
      </v-card-title>
      <!-- One sentence, not three fragments: which words agree with the count
           is the translator's problem to solve, and in most languages it is not
           solved by swapping "is" for "are". -->
      <v-card-text class="text-body-medium opacity-80">
        {{ earlier.length === 1
          ? $t('One earlier episode in this season is still unwatched.')
          : $t('{count} earlier episodes in this season are still unwatched.', { count: earlier.length }) }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="asking = false">
          {{ $t('No') }}
        </v-btn>
        <v-btn autofocus variant="tonal" @click="markEarlier">
          {{ $t('Mark watched') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
