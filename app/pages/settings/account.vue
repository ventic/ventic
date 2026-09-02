<script setup lang="ts">
import type { Backup } from '~/utils/backup'
import {
  mdiCloudSyncOutline,
  mdiContentSaveOutline,
  mdiFolderOpenOutline,
  mdiLinkOff,
  mdiRestore,
  mdiSync,
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
const sync = useSyncStore()

/**
 * A folder on a server the user already has, and nothing else. WebDAV is the one
 * thing every hosted drive and every NAS speaks without an OAuth client to
 * register or a review to pass — see utils/sync.ts for why that is the whole
 * answer for now.
 */
const showPassword = ref(false)

/**
 * The one address in the app that names a service, and it is storage rather
 * than a source — the line in the README is about where films come from, not
 * where a JSON file is kept. It earns the place by working exactly as typed:
 * everything else is a shape somebody has to fill their own server into.
 */
const KOOFR = 'https://app.koofr.net/dav/Koofr'

const lastSynced = computed(() =>
  sync.config.at ? new Date(sync.config.at).toLocaleString(uiLocale()) : '')

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
      :hint="$t('Keep what you have watched in step across every screen you use Ventic on. There is no Ventic account and no server of ours in the middle: the app keeps one small file in storage you already have, and every device reads and writes that same file.')"
    >
      <p class="text-body-medium max-w-prose opacity-70">
        {{ $t('Anything that speaks WebDAV works — a hosted drive, a Nextcloud or ownCloud, a NAS, or any server of your own that accepts a file. Paste the address of a folder there and Ventic keeps a {file} inside it. Nothing is uploaded until you do.', { file: 'ventic-sync.json' }) }}
      </p>

      <!-- One address that works as typed, because "anything that speaks
           WebDAV" is not something you can paste. -->
      <p class="text-body-small max-w-prose opacity-70">
        {{ $t('Koofr is the quickest to set up: sign up, make an app password under Preferences, then use {url} with your email as the username. A Nextcloud or ownCloud one looks like {other} instead.', {
          url: KOOFR,
          other: 'https://your-server/remote.php/dav/files/you',
        }) }}
      </p>

      <tv-field :label="$t('Address of a folder')">
        <v-text-field
          v-model="sync.config.url"
          :label="$t('Address of a folder')"
          :placeholder="KOOFR"
          persistent-placeholder
          density="comfortable"
          variant="outlined"
          hide-details
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
        />
      </tv-field>

      <div class="flex flex-wrap gap-3">
        <tv-field :label="$t('Username')" class="min-w-56 flex-1">
          <v-text-field
            v-model="sync.config.user"
            :label="$t('Username')"
            density="comfortable"
            variant="outlined"
            hide-details
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </tv-field>
        <tv-field :label="$t('Password')" class="min-w-56 flex-1">
          <v-text-field
            v-model="sync.config.pass"
            :label="$t('Password')"
            :type="showPassword ? 'text' : 'password'"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </tv-field>
      </div>

      <!-- A checkbox rather than the icon inside the field: an overlaid button
           there is one more thing for a d-pad crossing the row to fall into. -->
      <v-checkbox
        v-model="showPassword"
        density="compact"
        hide-details
        :label="$t('Show password')"
      />

      <p class="text-body-small max-w-prose opacity-70">
        {{ $t('Most servers let you make a password that only works for one app — use one of those here rather than the password to your whole account. It is stored on this device and is the one thing a backup file never carries.') }}
      </p>

      <div class="text-title-small mt-2">
        {{ $t('What travels') }}
      </div>
      <div v-for="group in SYNC_GROUPS" :key="group.key">
        <v-switch
          v-model="sync.config.groups[group.key]"
          color="primary"
          density="comfortable"
          hide-details
          :label="group.title()"
        />
        <p class="text-body-small max-w-prose opacity-70">
          {{ group.hint() }}
        </p>
      </div>

      <p class="text-body-small max-w-prose opacity-70">
        {{ $t('Downloaded files, the folder they are kept in, your playlists and anything holding a password stay on this device whatever is switched on.') }}
      </p>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <v-btn
          :prepend-icon="mdiSync"
          variant="tonal"
          :loading="sync.running"
          :disabled="!sync.on"
          @click="sync.run()"
        >
          {{ $t('Sync now') }}
        </v-btn>
        <v-btn
          v-if="sync.on"
          :prepend-icon="mdiLinkOff"
          variant="text"
          @click="sync.disconnect()"
        >
          {{ $t('Stop syncing') }}
        </v-btn>
      </div>

      <v-alert v-if="sync.error" type="warning" variant="tonal" density="compact" :text="sync.error" />
      <p v-else-if="lastSynced" class="text-body-medium opacity-70">
        <v-icon :icon="mdiCloudSyncOutline" size="18" class="mr-1" />
        {{ $t('Last synced {at}.', { at: lastSynced }) }}
      </p>
      <p v-else-if="sync.on" class="text-body-medium opacity-70">
        {{ $t('Not synced yet. Press Sync now, or wait — Ventic syncs on its own every few minutes and whenever a film ends.') }}
      </p>

      <p class="text-body-small max-w-prose opacity-70">
        {{ $t('Two screens are merged rather than one overwriting the other, so watching something on one and something else on the other keeps both. Removing a film from a list removes it everywhere.') }}
      </p>
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
