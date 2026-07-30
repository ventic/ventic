<script setup lang="ts">
import type { Backup } from '~/utils/backup'
import {
  mdiAccountCircleOutline,
  mdiContentSaveOutline,
  mdiFolderOpenOutline,
  mdiLogoutVariant,
  mdiOpenInNew,
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
const trakt = useTraktStore()

const syncedText = computed(() =>
  trakt.lastSync ? `Last synced ${new Date(trakt.lastSync).toLocaleString()}.` : 'Not synced yet.')

/**
 * A convenience, never the only way through: the code is on screen either way,
 * and on a TV it is typed on a phone. `canOpenFolder` is the wrong test here —
 * Android can't show a folder but opens a URL perfectly well.
 */
function openUrl(url: string) {
  if (isTauri())
    useTauriShellOpen(url).catch(() => {})
  else
    window.open(url, '_blank', 'noopener')
}

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
    note.value = `Downloaded as ${FILE}.`
    return
  }

  try {
    await useTauriFsWriteTextFile(FILE, text, { baseDir: DOCUMENTS })
    folder.value = await documentDir().catch(() => '')
    note.value = `Saved to your documents folder as ${FILE}.`
  }
  catch (e) {
    error.value = `Couldn't write the backup: ${e}`
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
    error.value = `There's no ${FILE} in your documents folder. Copy one there and try again.`
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
      title="Trakt"
      hint="Optional. Ventic keeps your library on this device; connect Trakt and it keeps a second
        copy there too, so a show you start on one screen carries on from the same place on another.
        Everything works without it."
    >
      <v-card rounded="xl" class="panel flex flex-col items-start gap-3 p-6">
        <v-icon :icon="mdiAccountCircleOutline" size="48" class="opacity-40" />

        <!-- No credentials compiled in: nothing here can work, so nothing here pretends to. -->
        <template v-if="!trakt.available">
          <div class="text-title-medium">
            Not available in this build
          </div>
          <p class="text-body-medium max-w-prose opacity-70">
            This copy of Ventic was built without Trakt credentials, so there is nothing for it to
            sign in to. Everything else on this page is stored on this device and never leaves it.
          </p>
        </template>

        <!-- The device flow, mid-flight: six digits, typed on any device. -->
        <template v-else-if="trakt.code">
          <div class="text-title-medium">
            Enter this code on trakt.tv
          </div>
          <div class="text-display-small font-mono tracking-widest">
            {{ trakt.code.user_code }}
          </div>
          <p class="text-body-medium max-w-prose opacity-70">
            Open <strong>{{ trakt.code.verification_url }}</strong> on this or any other device,
            sign in, and type the code above. Ventic is waiting for it.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <v-btn :prepend-icon="mdiOpenInNew" variant="tonal" @click="openUrl(trakt.code.verification_url)">
              Open trakt.tv
            </v-btn>
            <v-btn variant="text" @click="trakt.cancel()">
              Cancel
            </v-btn>
          </div>
          <v-progress-linear indeterminate rounded class="max-w-xs" />
        </template>

        <template v-else-if="trakt.signedIn">
          <div class="text-title-medium">
            Connected as {{ trakt.who }}
          </div>
          <p class="text-body-medium max-w-prose opacity-70">
            What you watch is reported to Trakt as it plays, and what you watched elsewhere is
            pulled back in. {{ syncedText }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <v-btn
              :prepend-icon="mdiSync"
              variant="tonal"
              :loading="trakt.syncing"
              @click="trakt.sync(true)"
            >
              Sync now
            </v-btn>
            <v-btn :prepend-icon="mdiLogoutVariant" variant="text" @click="trakt.disconnect()">
              Disconnect
            </v-btn>
          </div>
        </template>

        <template v-else>
          <div class="text-title-medium">
            Not connected
          </div>
          <p class="text-body-medium max-w-prose opacity-70">
            Connecting shows a short code to type on trakt.tv — no password is typed here, and
            nothing but watch state is shared: progress, watched marks, your favourites and your
            watchlist. Your sources, downloads and settings stay local.
          </p>
          <v-btn variant="tonal" color="primary" @click="trakt.connect()">
            Connect Trakt
          </v-btn>
        </template>

        <v-alert
          v-if="trakt.note"
          type="success"
          variant="tonal"
          density="compact"
          class="w-full"
          :text="trakt.note"
        />
        <v-alert
          v-if="trakt.error"
          type="warning"
          variant="tonal"
          density="compact"
          class="w-full"
          :text="trakt.error"
        />
      </v-card>
    </settings-section>

    <settings-section
      title="Backup"
      :hint="`Your watch history, favourites, watchlist, sources and every preference here, written
        to a single ${FILE}. Carry it to another device and restore it there, or keep one against
        the day this one is wiped.`"
    >
      <div class="text-body-small opacity-70">
        {{ library.history.length }} titles watched · {{ library.favouriteList.length }} favourites ·
        {{ library.watchlistItems.length }} on the watchlist
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <v-btn :prepend-icon="mdiContentSaveOutline" variant="tonal" @click="save">
          Save a backup
        </v-btn>
        <v-btn :prepend-icon="mdiRestore" variant="text" @click="restore">
          Restore…
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
            Show
          </v-btn>
        </template>
      </v-alert>
      <v-alert v-if="error" type="warning" variant="tonal" density="compact" :text="error" />

      <v-dialog :model-value="!!pending" max-width="460" @update:model-value="pending = null">
        <v-card v-if="summary" rounded="xl" title="Restore this backup?">
          <v-card-text class="flex flex-col gap-3">
            <p class="text-body-medium opacity-80">
              Everything it holds replaces what is on this device: {{ summary.titles }} titles,
              {{ summary.watched }} watch positions, {{ summary.favourites }} favourites,
              {{ summary.watchlist }} on the watchlist and {{ summary.sources }} sources.
              Downloads on the disk are untouched.
            </p>
            <p v-if="summary.sources" class="text-body-small opacity-60">
              Restoring changes which servers Ventic searches — a backup carries its own
              source list, and it wins.
            </p>
            <p v-if="pending?.at" class="text-body-small opacity-60">
              Written {{ new Date(pending.at).toLocaleString() }}.
            </p>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="pending = null">
              Cancel
            </v-btn>
            <v-btn variant="tonal" color="primary" @click="apply">
              Restore and reload
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </settings-section>
  </div>
</template>
