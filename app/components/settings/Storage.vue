<script setup lang="ts">
import { mdiDeleteOutline, mdiDeleteSweepOutline, mdiFolderOpenOutline, mdiFolderSearchOutline, mdiRestore } from '@mdi/js'

const settings = useSettingsStore()
const downloads = useDownloadsStore()
const library = useLibraryStore()

const error = ref('')
const canReveal = canOpenFolder()
const confirmClear = ref(false)
const confirmPrune = ref(false)

// clearAll swallows per-torrent failures — whatever survives is still in the list.
async function prune() {
  confirmPrune.value = false
  await downloads.clearAll()
}

/** GiB on the slider, bytes in the store. 0 stays 0 — that's "use the disk". */
const capGb = computed({
  get: () => Math.round(downloads.cap / 1024 ** 3),
  set: (value: number) => (downloads.cap = value * 1024 ** 3),
})

const usedShare = computed(() =>
  Number.isFinite(downloads.budget) && downloads.budget > 0
    ? Math.min(100, (downloads.used / downloads.budget) * 100)
    : 0)

async function browse() {
  error.value = ''
  try {
    const picked = await useTauriDialogOpen({ directory: true, multiple: false, title: 'Where to keep downloads' })
    if (typeof picked === 'string')
      settings.downloadDir = picked
  }
  catch (e) {
    // Android has no directory chooser, and a browser-only dev session has no
    // Tauri at all — the path field beside the button still works.
    error.value = `${e}`
  }
}

async function openFolder() {
  if (settings.downloadDir)
    await useTauriShellOpen(settings.downloadDir).catch((e: unknown) => (error.value = `${e}`))
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      title="Download folder"
      hint="Where films and episodes are written. Torrents already downloaded stay where they are."
    >
      <v-text-field
        v-model="settings.downloadDir"
        label="Folder"
        placeholder="Default: the app's own cache folder"
        persistent-placeholder
        hide-details
      />

      <div class="flex flex-wrap items-center gap-2">
        <v-btn :prepend-icon="mdiFolderSearchOutline" variant="tonal" @click="browse">
          Browse…
        </v-btn>
        <v-btn
          v-if="canReveal"
          :prepend-icon="mdiFolderOpenOutline"
          variant="text"
          :disabled="!settings.downloadDir"
          @click="openFolder"
        >
          Open
        </v-btn>
        <v-btn
          v-if="settings.downloadDir"
          :prepend-icon="mdiRestore"
          variant="text"
          @click="settings.downloadDir = ''"
        >
          Use default
        </v-btn>
      </div>

      <v-alert v-if="error" type="warning" variant="tonal" density="compact" :text="error" />
    </settings-section>

    <settings-section
      title="Cache limit"
      hint="Everything watched is kept on disk until the space is needed, then the least recently
        played titles are deleted. Zero lets that grow into whatever the drive has spare."
    >
      <div class="text-label-medium opacity-70">
        {{ capGb > 0 ? `${capGb} GiB` : 'Whatever the disk allows' }}
      </div>
      <v-slider v-model="capGb" :min="0" :max="500" :step="5" thumb-label />

      <div class="flex flex-col gap-1">
        <v-progress-linear :model-value="usedShare" />
        <div class="text-body-small opacity-70">
          {{ bytesText(downloads.used) }} used
          <template v-if="isFinite(downloads.budget)">
            of {{ bytesText(downloads.budget) }} available
          </template>
          <template v-if="downloads.disk">
            · {{ bytesText(downloads.disk.free) }} free on the drive
          </template>
        </div>
      </div>

      <div>
        <v-btn
          :prepend-icon="mdiDeleteSweepOutline"
          variant="tonal"
          color="error"
          :disabled="!downloads.torrents.length"
          @click="confirmPrune = true"
        >
          Delete all downloads
        </v-btn>
      </div>

      <v-dialog v-model="confirmPrune" max-width="420">
        <v-card
          title="Delete all downloads?"
          :text="`All ${downloads.torrents.length} torrents and their files are removed from the disk,
            freeing ${bytesText(downloads.used)}. Anything still playing stops. Watch history is kept.`"
        >
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmPrune = false">
              Cancel
            </v-btn>
            <v-btn variant="tonal" color="error" @click="prune">
              Delete
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </settings-section>

    <settings-section
      title="Watch history"
      hint="Progress, watched marks, favourites and the watchlist, kept on this device only. Clearing
        them here clears them for good — Account has a backup file if you want one first."
    >
      <div class="text-body-small opacity-70">
        {{ library.history.length }} titles watched · {{ library.favouriteList.length }} favourites ·
        {{ library.watchlistItems.length }} on the watchlist
      </div>
      <div>
        <v-btn
          :prepend-icon="mdiDeleteOutline"
          variant="tonal"
          color="error"
          :disabled="!library.history.length && !library.favouriteList.length && !library.watchlistItems.length"
          @click="confirmClear = true"
        >
          Clear watch history
        </v-btn>
      </div>

      <v-dialog v-model="confirmClear" max-width="420">
        <v-card
          title="Clear watch history?"
          text="Every progress bar, watched mark, favourite and watchlist entry goes. This can't be undone."
        >
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmClear = false">
              Cancel
            </v-btn>
            <v-btn variant="tonal" color="error" @click="library.clear(); confirmClear = false">
              Clear
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </settings-section>
  </div>
</template>
