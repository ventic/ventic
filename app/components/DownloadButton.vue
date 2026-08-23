<script setup lang="ts">
import type { MediaType } from '~/utils/tmdb'
import { mdiCheck, mdiDownload } from '@mdi/js'

// Same lookup the player does, minus the playing: the torrent stays in the
// engine and the downloads page takes it from there.
//
// `type`/`id` are what the download is filed under, so that pressing Play on
// this title later finds the copy this button fetched instead of searching for
// another one.
const props = defineProps<{
  type?: MediaType
  id?: string | number
  imdbId?: string | null
  season?: number
  episode?: number
}>()

const downloads = useDownloadsStore()

const key = computed(() => props.type && props.id
  ? progressKey(props.type, props.id, props.season, props.episode)
  : '')

const state = ref<'idle' | 'busy' | 'done'>('idle')
const error = ref('')

const done = computed(() => state.value === 'done')

// Picking another episode makes the previous "In downloads" a lie.
watch(() => [props.imdbId, props.season, props.episode].join('|'), () => {
  state.value = 'idle'
  error.value = ''
})

async function download() {
  state.value = 'busy'
  error.value = ''
  try {
    await downloads.start(key.value, {
      imdbId: props.imdbId,
      season: props.season,
      episode: props.episode,
    })
    state.value = 'done'
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    state.value = 'idle'
  }
}
</script>

<template>
  <v-btn
    :prepend-icon="done ? mdiCheck : mdiDownload"
    :loading="state === 'busy'"
    :color="error ? 'error' : undefined"
    :to="done ? localePath('/downloads') : undefined"
    :disabled="!imdbId"
    variant="tonal"
    @click="done || download()"
  >
    {{ done ? $t('In downloads') : error ? $t('Retry download') : $t('Download') }}
    <v-tooltip v-if="error" activator="parent" :text="error" />
  </v-btn>
</template>
