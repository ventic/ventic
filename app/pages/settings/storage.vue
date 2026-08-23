<script setup lang="ts">
import { mdiCheckCircle, mdiDeleteOutline, mdiDeleteSweepOutline, mdiFolderOpenOutline, mdiFolderSearchOutline, mdiRestore, mdiUsbFlashDrive } from '@mdi/js'

const settings = useSettingsStore()
const downloads = useDownloadsStore()
const library = useLibraryStore()

const error = ref('')
const canReveal = canOpenFolder()
// Android names the drives it will accept instead of offering a chooser, so
// there the folder is picked from a list.
const volumes = ref(storageVolumes())

function refresh() {
  volumes.value = storageVolumes()
  // A formatted drive is a new volume with a new path, so a folder chosen before
  // the format names somewhere that no longer exists. On Android anything off
  // this list is unwritable, and '' is the app's own folder — which always works.
  if (settings.downloadDir && volumes.value && !volumes.value.some(v => v.writable && v.path === settings.downloadDir))
    settings.downloadDir = ''
}

// Android is often still mounting the drive as the app comes back — a format
// finishes on its own schedule, not on the activity's — so the list is read
// again a moment after the one that lands too early. Measured on the TV: the
// read on resume alone still showed the old list.
const { start: recheck } = useTimeoutFn(refresh, 1500, { immediate: false })

/**
 * Re-read the drives whenever the app comes back to the foreground.
 *
 * Formatting a stick means leaving for Android's storage settings and coming
 * back, so a list read once at mount is stale exactly when the user has just
 * fixed the problem — which is what made them switch tabs to force a re-read.
 * `visibilitychange` is what the webview gets on that round trip (measured on
 * the TV: hidden, then visible).
 */
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState !== 'visible')
    return
  refresh()
  recheck()
})

const drives = computed(() => volumes.value?.filter(v => v.writable))
// Plugged in, mounted, and unwritable — an NTFS stick, or a format this box has
// no driver for. Naming it is the only way the user learns it has to be
// reformatted; Android fails the folder silently and every app here is stuck.
const blocked = computed(() => volumes.value?.filter(v => !v.writable) ?? [])

// The drive downloads actually land on: the chosen one, or built-in storage,
// which is the volume Android lists first.
const target = computed(() =>
  (settings.downloadDir ? drives.value?.find(d => d.path === settings.downloadDir) : drives.value?.[0]) ?? null)

// Room for one film. Under it a TV box can't finish a download at all, which is
// the state a 2 GB set-top arrives in — worth saying out loud rather than
// leaving the user to discover it as a stalled download.
const FILM_BYTES = 8 * 1024 ** 3
const cramped = computed(() =>
  isTv() === true && !!drives.value?.length && drives.value.every(d => d.free < FILM_BYTES))

// Only Android has a system screen to send them to; `volumes` being non-null is
// the same thing as the bridge being there.
const canFormat = computed(() => !!volumes.value)
const formatHint = ref(false)

/**
 * Hand off to Android's storage settings. We deliberately don't name a
 * filesystem: which ones a box supports is not something an app can read, and
 * the system's own wizard formats the drive in one that works there.
 */
function format() {
  if (openStorageSettings())
    formatHint.value = true
  else
    error.value = $t('No storage settings on this device. Format the drive as FAT32 on a computer — every Android box accepts it.')
}

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
    const picked = await useTauriDialogOpen({ directory: true, multiple: false, title: $t('Where to keep downloads') })
    if (typeof picked === 'string')
      settings.downloadDir = picked
  }
  catch (e) {
    // A browser-only dev session has no Tauri at all — the path field beside the
    // button still works. (Android never gets here: it lists its drives instead.)
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
      :title="volumes ? $t('Where downloads go') : $t('Download folder')"
      :hint="volumes
        ? $t('Which drive films and episodes are written to — a plugged-in stick usually holds far more than the box itself. Uninstalling the app still removes them. Torrents already downloaded stay where they are.')
        : $t('Where films and episodes are written. Torrents already downloaded stay where they are.')"
    >
      <v-text-field
        v-model="settings.downloadDir"
        :label="$t('Folder')"
        :placeholder="$t('Default: the app\'s own cache folder')"
        persistent-placeholder
        hide-details
        :readonly="!!volumes"
      />

      <!-- One button per drive rather than a radio group: it is the shape a
           remote already knows, and the free space is the whole reason to pick
           one over the other. -->
      <div v-if="drives?.length" class="flex flex-col gap-2">
        <v-btn
          v-for="volume in drives"
          :key="volume.path"
          :prepend-icon="settings.downloadDir === volume.path ? mdiCheckCircle : mdiUsbFlashDrive"
          :variant="settings.downloadDir === volume.path ? 'tonal' : 'outlined'"
          class="justify-start"
          @click="settings.downloadDir = volume.path"
        >
          {{ $t('{drive} · {free} free', { drive: volume.name, free: bytesText(volume.free) }) }}
        </v-btn>
      </div>

      <!-- Said at the moment the drive is picked, not left for the download that
           dies at 4 GiB. The source list dims those releases (TorrentPicker),
           so this explains what is about to be seen there. -->
      <v-alert
        v-if="target?.maxFile"
        type="info"
        variant="tonal"
        density="compact"
        :text="$t('{drive} is formatted FAT32, which can\'t hold a single file over {limit}. Bigger releases are dimmed in the source list and are never picked automatically — everything smaller works normally.', { drive: target.name, limit: bytesText(target.maxFile) })"
      />

      <!-- The fix is one screen away, so the alert carries the way to it rather
           than a filesystem name the user would have to act on elsewhere. -->
      <v-alert
        v-for="volume in blocked"
        :key="volume.name"
        type="warning"
        variant="tonal"
        density="compact"
      >
        {{ $t('{drive} is plugged in, but nothing can be written to it — this device doesn\'t support the format the drive is in. Formatting it here fixes that, and erases whatever is on the drive.', { drive: volume.name }) }}

        <template #append>
          <v-btn v-if="canFormat" :prepend-icon="mdiUsbFlashDrive" variant="tonal" @click="format">
            {{ $t('Format drive…') }}
          </v-btn>
        </template>
      </v-alert>

      <v-alert
        v-if="formatHint"
        type="info"
        variant="tonal"
        density="compact"
        :text="$t('In the screen that just opened, choose the drive, then “Erase & format as removable storage”. Come back here afterwards and it will be in the list.')"
      />

      <!-- Not while a drive is sitting there unreadable: "plug one in" is the
           wrong advice when one is plugged in. -->
      <v-alert
        v-if="cramped && !blocked.length"
        type="info"
        variant="tonal"
        density="compact"
        :text="$t('There is barely room for one film here. Plug a USB drive into the box — formatted FAT32, which every Android box accepts — and it appears above to download onto instead.')"
      />

      <div class="flex flex-wrap items-center gap-2">
        <v-btn v-if="!volumes" :prepend-icon="mdiFolderSearchOutline" variant="tonal" @click="browse">
          {{ $t('Browse…') }}
        </v-btn>
        <v-btn
          v-if="canReveal"
          :prepend-icon="mdiFolderOpenOutline"
          variant="text"
          :disabled="!settings.downloadDir"
          @click="openFolder"
        >
          {{ $t('Open') }}
        </v-btn>
        <v-btn
          v-if="settings.downloadDir"
          :prepend-icon="mdiRestore"
          variant="text"
          @click="settings.downloadDir = ''"
        >
          {{ $t('Use default') }}
        </v-btn>
      </div>

      <v-alert v-if="error" type="warning" variant="tonal" density="compact" :text="error" />
    </settings-section>

    <settings-section
      :title="$t('Cache limit')"
      :hint="$t('Everything watched is kept on disk until the space is needed, then the least recently played titles are deleted. Zero lets that grow into whatever the drive has spare.')"
    >
      <div class="text-label-medium opacity-70">
        {{ capGb > 0 ? $t('{size} GiB', { size: capGb }) : $t('Whatever the disk allows') }}
      </div>
      <v-slider v-model="capGb" :min="0" :max="500" :step="5" thumb-label />

      <div class="flex flex-col gap-1">
        <v-progress-linear :model-value="usedShare" />
        <div class="text-body-small opacity-70">
          {{ $t('{used} used', { used: bytesText(downloads.used) }) }}
          <template v-if="isFinite(downloads.budget)">
            {{ $t('of {total} available', { total: bytesText(downloads.budget) }) }}
          </template>
          <template v-if="downloads.disk">
            · {{ $t('{free} free on the drive', { free: bytesText(downloads.disk.free) }) }}
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
          {{ $t('Delete all downloads') }}
        </v-btn>
      </div>

      <v-dialog v-model="confirmPrune" max-width="420">
        <v-card
          :title="$t('Delete all downloads?')"
          :text="$t('All {count} torrents and their files are removed from the disk, freeing {size}. Anything still playing stops. Watch history is kept.', { count: downloads.torrents.length, size: bytesText(downloads.used) })"
        >
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmPrune = false">
              {{ $t('Cancel') }}
            </v-btn>
            <v-btn variant="tonal" color="error" @click="prune">
              {{ $t('Delete') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </settings-section>

    <settings-section
      :title="$t('Watch history')"
      :hint="$t('Progress, watched marks, favourites and the watchlist, kept on this device only. Clearing them here clears them for good — Account has a backup file if you want one first.')"
    >
      <div class="text-body-small opacity-70">
        {{ $t('{titles} titles watched · {favourites} favourites · {watchlist} on the watchlist', {
          titles: library.history.length,
          favourites: library.favouriteList.length,
          watchlist: library.watchlistItems.length,
        }) }}
      </div>
      <div>
        <v-btn
          :prepend-icon="mdiDeleteOutline"
          variant="tonal"
          color="error"
          :disabled="!library.history.length && !library.favouriteList.length && !library.watchlistItems.length"
          @click="confirmClear = true"
        >
          {{ $t('Clear watch history') }}
        </v-btn>
      </div>

      <v-dialog v-model="confirmClear" max-width="420">
        <v-card
          :title="$t('Clear watch history?')"
          :text="$t('Every progress bar, watched mark, favourite and watchlist entry goes. This can\'t be undone.')"
        >
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmClear = false">
              {{ $t('Cancel') }}
            </v-btn>
            <v-btn variant="tonal" color="error" @click="library.clear(); confirmClear = false">
              {{ $t('Clear') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </settings-section>
  </div>
</template>
