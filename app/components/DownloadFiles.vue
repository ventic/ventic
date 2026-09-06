<script setup lang="ts">
import type { EngineFile, EngineTorrent } from '~/utils/torrents'
import { mdiFolderOpenOutline, mdiPlay } from '@mdi/js'

/**
 * What is actually inside a torrent: pick the episode you want, play any of
 * them, or tick one off to stop it downloading.
 *
 * Only ever mounted under the one open row, so the fetch below happens exactly
 * when the files are wanted — and, like the row above it, drawn with plain
 * elements: a season pack is two dozen lines, and a Vuetify button with a
 * tooltip per line per action is a hundred components for a list that is read
 * once and tapped once.
 */
const props = defineProps<{ torrent: EngineTorrent }>()

const emit = defineEmits<{
  /** Play one file out of the pack. The file itself so the downloads page can
      read the episode off its name — see `filedAs`. */
  play: [index: number, file: EngineFile]
  /** Open the file's own folder. */
  open: [file: EngineFile]
}>()

const downloads = useDownloadsStore()

const files = ref<EngineFile[]>([])
const canReveal = canOpenFolder()

const ACT = 'grid size-8 shrink-0 place-items-center border-0 rounded-lg bg-transparent text-on-surface opacity-70 transition-colors hover:bg-surface-container-high hover:opacity-100 focus-visible:bg-surface-container-high focus-visible:opacity-100'

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
</script>

<template>
  <div class="flex flex-col gap-0.5 rounded-xl bg-surface-container/40 px-2 py-2 sm:px-3">
    <div class="truncate px-2 pb-1 text-body-small opacity-55" :title="torrent.output_folder">
      {{ torrent.output_folder }}
    </div>

    <div v-if="!files.length" class="px-2 py-2 text-body-small opacity-55">
      {{ $t('Waiting for metadata…') }}
    </div>

    <!-- Two shapes: a phone stacks the name over its own stats, a desktop puts
         them on one line. The controls are the same either way. -->
    <div
      v-for="(file, index) in files"
      :key="file.name"
      class="flex flex-col gap-1 rounded-lg px-1 py-1 sm:flex-row sm:items-center sm:gap-3 sm:px-2 hover:bg-surface-container-high/60"
    >
      <div class="flex min-w-0 items-center gap-1 sm:flex-1">
        <v-checkbox-btn
          :model-value="file.included"
          density="compact"
          class="shrink-0 grow-0"
          @update:model-value="value => setIncluded(index, !!value)"
        />
        <span class="min-w-0 flex-1 truncate text-body-small" :title="file.name">{{ file.name }}</span>
      </div>

      <div class="flex items-center gap-2 pl-10 sm:gap-3 sm:pl-0">
        <span class="shrink-0 text-body-small tabular-nums opacity-55 sm:w-16 sm:text-right">{{ bytesText(file.length) }}</span>
        <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-on-surface/12 sm:w-24 sm:flex-none">
          <div class="h-full rounded-full bg-primary" :style="{ width: `${progress(index)}%` }" />
        </div>
        <span class="w-9 shrink-0 text-right text-body-small tabular-nums opacity-55">
          {{ progress(index).toFixed(0) }}%
        </span>
        <button type="button" :class="ACT" :title="$t('Play this file')" @click="emit('play', index, file)">
          <svg viewBox="0 0 24 24" class="size-5 fill-current"><path :d="mdiPlay" /></svg>
        </button>
        <button v-if="canReveal" type="button" :class="ACT" :title="$t('Open containing folder')" @click="emit('open', file)">
          <svg viewBox="0 0 24 24" class="size-5 fill-current"><path :d="mdiFolderOpenOutline" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>
