<script setup lang="ts">
import type { Backup } from '~/utils/backup'
import {
  mdiAccountCircleOutline,
  mdiContentSaveOutline,
  mdiFolderOpenOutline,
  mdiRestore,
} from '@mdi/js'
import { isTauri } from '@tauri-apps/api/core'
import { documentDir } from '@tauri-apps/api/path'

/**
 * The library is local, and this is what stops that meaning "one cleared
 * webview from gone". `utils/backup.ts` owns the rules; this only decides where
 * the file goes.
 *
 * One fixed name in the documents folder rather than a save dialog.
 * That is the one directory the app is granted on every target it ships to
 * (`fs:allow-document-*` in the capabilities), it needs no picker a remote
 * can't drive, and a backup is a thing you want the latest of. Add a dialog the
 * day someone wants to keep two.
 */
const FILE = 'ventic-backup.json'
const DOCUMENTS = useTauriFsBaseDirectory.Document

const library = useLibraryStore()

const error = ref('')
const note = ref('')
const pending = ref<Backup | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
/** Set once a file has really been written, so "Show" has a folder to open. */
const folder = ref('')

const summary = computed(() => pending.value ? backupSummary(pending.value) : null)

async function save() {
  error.value = ''
  note.value = ''
  const text = JSON.stringify(makeBackup(localStorage), null, 2)

  if (!isTauri()) {
    // A browser dev session has no documents folder to write to, so hand the
    // file to the browser instead and let it go wherever downloads go.
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    Object.assign(document.createElement('a'), { href: url, download: FILE }).click()
    URL.revokeObjectURL(url)
    note.value = $t('Downloaded as {file}.', { file: FILE })
    return
  }

  try {
    await useTauriFsWriteTextFile(FILE, text, { baseDir: DOCUMENTS })
    folder.value = await documentDir().catch(() => '')
    note.value = $t('Saved to your documents folder as {file}.', { file: FILE })
  }
  catch (e) {
    error.value = $t('Couldn\'t write the backup: {error}', { error: String(e) })
  }
}

function stage(text: string) {
  error.value = ''
  note.value = ''
  try {
    pending.value = readBackup(text)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function restore() {
  error.value = ''
  note.value = ''
  // Same asymmetry as saving: a browser has no documents folder, so it picks.
  if (!isTauri())
    return fileInput.value?.click()

  try {
    stage(await useTauriFsReadTextFile(FILE, { baseDir: DOCUMENTS }))
  }
  catch {
    error.value = $t('There\'s no {file} in your documents folder. Copy one there and try again.', { file: FILE })
  }
}

async function chosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file)
    stage(await file.text())
}

function apply() {
  applyBackup(pending.value!, localStorage)
  pending.value = null
  // Every store read its refs out of localStorage once, at setup, and nothing
  // is watching for a write from this same document — so the reload is the
  // restore. It also lands the user on a home page built from the new library.
  window.location.reload()
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Sync')"
      :hint="$t('Ventic keeps your library on this device. Carrying it to another screen is the backup file below.')"
    >
      <!-- Text only, so nothing here for the d-pad to walk into. -->
      <v-card rounded="xl" class="panel flex flex-col items-start gap-3 p-6">
        <v-icon :icon="mdiAccountCircleOutline" size="48" class="opacity-40" />
        <div class="text-title-medium">
          {{ $t('Not supported yet') }}
        </div>
        <p class="text-body-medium max-w-prose opacity-70">
          {{ $t('There is no account to sign in to and nothing syncs to a server. What you watch, how far you got, your favourites and your watchlist are all stored on this device and never leave it. Syncing between screens is planned; until then, the backup below is how a library moves.') }}
        </p>
      </v-card>
    </settings-section>

    <settings-section
      :title="$t('Backup')"
      :hint="$t('Your watch history, favourites, watchlist, sources and every preference here, written to a single {file}. Carry it to another device and restore it there, or keep one against the day this one is wiped.', { file: FILE })"
    >
      <div class="text-body-small opacity-70">
        {{ $t('{titles} titles watched · {favourites} favourites · {watchlist} on the watchlist', {
          titles: library.history.length,
          favourites: library.favouriteList.length,
          watchlist: library.watchlistItems.length,
        }) }}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <v-btn :prepend-icon="mdiContentSaveOutline" variant="tonal" @click="save">
          {{ $t('Save a backup') }}
        </v-btn>
        <v-btn :prepend-icon="mdiRestore" variant="text" @click="restore">
          {{ $t('Restore…') }}
        </v-btn>
        <!-- The browser path, and the only one on a machine with no Tauri
             around it. Hidden rather than absent so `restore` can click it. -->
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="chosen"
        >
      </div>

      <v-alert v-if="note" type="success" variant="tonal" density="compact" :text="note">
        <template v-if="folder && canOpenFolder()" #append>
          <v-btn
            size="small"
            variant="text"
            :prepend-icon="mdiFolderOpenOutline"
            @click="useTauriShellOpen(folder)"
          >
            {{ $t('Show') }}
          </v-btn>
        </template>
      </v-alert>
      <v-alert v-if="error" type="warning" variant="tonal" density="compact" :text="error" />

      <v-dialog :model-value="!!pending" max-width="460" @update:model-value="pending = null">
        <v-card v-if="summary" rounded="xl" :title="$t('Restore this backup?')">
          <v-card-text class="flex flex-col gap-3">
            <p class="text-body-medium opacity-80">
              {{ $t('Everything it holds replaces what is on this device: {titles} titles, {watched} watch positions, {favourites} favourites, {watchlist} on the watchlist and {sources} sources. Downloads on the disk are untouched.', summary) }}
            </p>
            <p v-if="summary.sources" class="text-body-small opacity-60">
              {{ $t('Restoring changes which servers Ventic searches — a backup carries its own source list, and it wins.') }}
            </p>
            <p v-if="pending?.at" class="text-body-small opacity-60">
              {{ $t('Written {at}.', { at: new Date(pending.at).toLocaleString(uiLocale()) }) }}
            </p>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="pending = null">
              {{ $t('Cancel') }}
            </v-btn>
            <v-btn variant="tonal" color="primary" @click="apply">
              {{ $t('Restore and reload') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </settings-section>
  </div>
</template>
