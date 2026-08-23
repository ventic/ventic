<script setup lang="ts">
import type { EngineFile, EngineTorrent } from '~/utils/torrents'
import { mdiContentCopy, mdiFolderOpenOutline, mdiPlayCircleOutline } from '@mdi/js'

/**
 * What is actually inside a torrent: pick the episode you want, play any of
 * them, or tick one off to stop it downloading.
 *
 * Its own component because the transfer list draws it in two places — under an
 * expanded table row on a desktop, inside the card on a phone — and it is the
 * same list either way. Only ever mounted while something is expanded, so the
 * fetch below happens exactly when the files are wanted.
 */
const props = defineProps<{ torrent: EngineTorrent }>()

const emit = defineEmits<{
  /** Play one file out of the pack. */
  play: [index: number]
  /** Open a folder — the file's own, or the torrent's root with no file given. */
  open: [file?: EngineFile]
  /** Something worth a snackbar happened. */
  notify: [message: string]
}>()

const downloads = useDownloadsStore()

const files = ref<EngineFile[]>([])
const canReveal = canOpenFolder()

async function load() {
  files.value = (await torrentDetails(props.torrent.id))?.files ?? []
}

// A torrent opened before its metadata arrived has no files to list yet; the
// next poll of the list is the cue to ask again.
watch(() => downloads.torrents, () => {
  if (!files.value.length)
    load()
})

watch(() => props.torrent.id, load, { immediate: true })

// Per-file progress rides along on the list poll, so it costs no extra request.
function progress(index: number) {
  const file = files.value[index]
  const have = props.torrent.stats?.file_progress?.[index] ?? 0
  return file?.length ? Math.min(100, (have / file.length) * 100) : 0
}

/** Ticking a file off stops it downloading; a torrent needs at least one. */
async function setIncluded(index: number, included: boolean) {
  const only = files.value.flatMap((f, i) => (i === index ? included : f.included) ? [i] : [])
  if (!only.length)
    return
  files.value = files.value.map((f, i) => i === index ? { ...f, included } : f)
  await limitToFiles(props.torrent.id, only)
  await downloads.refresh()
}

async function copyMagnet() {
  await navigator.clipboard.writeText(magnetForHash(props.torrent.info_hash))
  emit('notify', $t('Magnet link copied.'))
}
</script>

<template>
  <div class="flex flex-col gap-1 rounded-xl bg-surface-container/40 px-3 py-3 sm:px-4">
    <div class="flex flex-wrap items-center gap-2 text-body-small opacity-55">
      <span class="min-w-0 flex-1 truncate">{{ torrent.output_folder }}</span>
      <v-btn v-if="canReveal" :prepend-icon="mdiFolderOpenOutline" size="x-small" variant="text" @click="emit('open')">
        {{ $t('Open folder') }}
      </v-btn>
      <v-btn :prepend-icon="mdiContentCopy" size="x-small" variant="text" @click="copyMagnet">
        {{ $t('Copy magnet') }}
      </v-btn>
    </div>

    <div v-if="!files.length" class="py-2 text-body-small opacity-55">
      {{ $t('Waiting for metadata…') }}
    </div>

    <!-- Two shapes: a phone stacks the name over its own stats, a desktop puts
         them on one line. The controls are the same either way. -->
    <div
      v-for="(file, index) in files"
      :key="file.name"
      class="flex flex-col gap-1 rounded-lg px-1 py-1.5 sm:flex-row sm:items-center sm:gap-3 sm:px-2 sm:py-1 hover:bg-surface-container-high/60"
    >
      <div class="flex min-w-0 items-center gap-2 sm:flex-1">
        <v-checkbox-btn
          :model-value="file.included"
          density="compact"
          class="shrink-0 grow-0"
          @update:model-value="value => setIncluded(index, !!value)"
        />
        <span class="min-w-0 flex-1 truncate text-body-small" :title="file.name">{{ file.name }}</span>
      </div>

      <div class="flex items-center gap-2 pl-9 sm:gap-3 sm:pl-0">
        <span class="shrink-0 text-body-small tabular-nums opacity-55 sm:w-16 sm:text-right">{{ bytesText(file.length) }}</span>
        <div class="min-w-0 flex-1 sm:w-24 sm:flex-none">
          <v-progress-linear :model-value="progress(index)" height="4" rounded />
        </div>
        <span class="w-9 shrink-0 text-right text-body-small tabular-nums opacity-55">
          {{ progress(index).toFixed(0) }}%
        </span>
        <v-btn icon size="x-small" variant="text" color="on-surface" @click="emit('play', index)">
          <v-icon :icon="mdiPlayCircleOutline" size="18" />
          <v-tooltip activator="parent" :text="$t('Play this file')" />
        </v-btn>
        <v-btn v-if="canReveal" icon size="x-small" variant="text" color="on-surface" @click="emit('open', file)">
          <v-icon :icon="mdiFolderOpenOutline" size="18" />
          <v-tooltip activator="parent" :text="$t('Open containing folder')" />
        </v-btn>
      </div>
    </div>
  </div>
</template>
