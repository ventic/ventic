<script setup lang="ts">
import { mdiDeleteOutline, mdiInformationOutline, mdiPlus, mdiPowerPlugOutline, mdiTelevisionPlay } from '@mdi/js'
import { invoke } from '@tauri-apps/api/core'

/**
 * Where the app is allowed to look for something to play. Ventic ships with
 * this list empty and never adds to it on its own: a source is a server
 * someone else runs, and adding one is the user's decision to make.
 */
const settings = useSettingsStore()
const ui = useUiStore()

const url = ref('')
const error = ref('')

/** A new array rather than a push: localStorage and the search watcher see it. */
function append(value: string) {
  settings.sources = [...settings.sources, value]
}

function add() {
  if (!url.value.trim())
    return

  // Takes whatever the user copied — a stremio:// link, a manifest URL, a bare
  // origin — and reduces it to the base the search appends to.
  const value = normalizeSource(url.value)
  if (!value) {
    error.value = $t('That doesn\'t look like a URL. Paste an addon link, or one starting with https://')
    return
  }
  if (settings.sources.includes(value)) {
    error.value = $t('That source is already in the list.')
    return
  }

  append(value)
  url.value = ''
  error.value = ''
}

function remove(value: string) {
  settings.sources = settings.sources.filter(s => s !== value)
}

// --- Live TV ------------------------------------------------------------------

/**
 * A playlist is not a source and is kept apart from one: a source answers the
 * addon protocol for a title you looked up, a playlist is a file of channels
 * (see utils/iptv). Same rule though — the app ships with none and names none.
 */
const playlist = ref('')
const playlistError = ref('')

function addPlaylist() {
  const value = playlist.value.trim()
  if (!value)
    return
  // Only a URL, and only http(s): the fetch goes through Rust, and a `file://`
  // or `javascript:` here would be asking it to open something else entirely.
  if (!/^https?:\/\//i.test(value)) {
    playlistError.value = $t('A playlist is an http:// or https:// link to an M3U file.')
    return
  }
  if (settings.playlists.includes(value)) {
    playlistError.value = $t('That playlist is already in the list.')
    return
  }
  settings.playlists = [...settings.playlists, value]
  playlist.value = ''
  playlistError.value = ''
}

function removePlaylist(value: string) {
  settings.playlists = settings.playlists.filter(p => p !== value)
}

// --- Deep links ---------------------------------------------------------------

/** A `ventic://` link staged by plugins/deeplink.client.ts, awaiting a yes. */
const pending = computed(() => ui.pendingSource)

function confirmPending() {
  if (pending.value && !settings.sources.includes(pending.value))
    append(pending.value)
  ui.pendingSource = ''
}

// `stremio://` is the scheme addon pages already publish, so handling it makes
// their existing install buttons work here. Off by default and never touched
// silently: a machine with Stremio installed has its own handler, and quietly
// taking the scheme would break it.
const stremioLinks = ref(false)
const stremioBusy = ref(false)

onMounted(async () => {
  try {
    stremioLinks.value = await useTauriDeepLinkIsRegistered('stremio')
  }
  catch {}
})

async function toggleStremio(on: boolean | null) {
  stremioBusy.value = true
  try {
    await (on ? useTauriDeepLinkRegister('stremio') : useTauriDeepLinkUnregister('stremio'))
    // Registering rewrites the .desktop entry, quotes and all, which is what
    // stops Chromium browsers from opening the link. Startup does this too.
    await invoke('deep_link_fix_handler').catch(() => {})
  }
  catch (e) {
    // macOS reads schemes from the bundle and cannot change them at runtime.
    error.value = e instanceof Error ? e.message : String(e)
    stremioLinks.value = !on
  }
  finally {
    stremioBusy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Sources')"
      :hint="$t('Ventic searches nothing by itself. A source is a URL you add here, pointing at a server that answers with things to play. What a source offers, and whether you have the right to play it, is between you and whoever runs it.')"
    >
      <!-- Naming the protocol is what makes the empty box answerable: a user who
           knows the word can find an addon in one search. Naming a particular
           addon would make this project the one distributing the link. -->
      <v-alert variant="tonal" density="comfortable" rounded="lg" class="text-body-medium">
        <template #prepend>
          <v-icon :icon="mdiInformationOutline" />
        </template>
        <!-- i18n-t rather than $t: the sentence has markup inside it, and the
             two <code> spans are literal syntax a translator must not touch. -->
        <i18n-t keypath="Ventic speaks the {protocol}. Any Stremio addon URL works here — paste the {link} link or the {manifest} address and it'll be trimmed to what's needed." tag="span">
          <template #protocol>
            <strong>{{ $t('Stremio addon protocol') }}</strong>
          </template>
          <template #link>
            <code>stremio://</code>
          </template>
          <template #manifest>
            <code>manifest.json</code>
          </template>
        </i18n-t>
      </v-alert>

      <v-list v-if="settings.sources.length" bg-color="transparent" class="rounded-lg bg-surface-container/40">
        <v-list-item v-for="value in settings.sources" :key="value" :title="value">
          <template #append>
            <v-btn icon size="small" variant="text" color="on-surface" @click="remove(value)">
              <v-icon :icon="mdiDeleteOutline" size="20" />
              <v-tooltip activator="parent" :text="$t('Remove this source')" />
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <div v-else class="flex flex-col items-center gap-2 rounded-lg bg-surface-container/40 px-4 py-10 text-center">
        <v-icon :icon="mdiPowerPlugOutline" size="32" class="opacity-40" />
        <p class="text-body-medium opacity-70">
          {{ $t('No sources yet. Until you add one, the app plays what you already have — anything in Downloads, and any magnet or torrent file you open yourself.') }}
        </p>
      </div>

      <div class="flex items-start gap-2">
        <v-text-field
          v-model="url"
          :label="$t('Source URL')"
          placeholder="https://… or stremio://…"
          variant="solo-filled"
          density="comfortable"
          rounded="lg"
          flat
          :error-messages="error"
          @keydown.enter="add"
          @update:model-value="error = ''"
        />
        <v-btn :prepend-icon="mdiPlus" variant="tonal" size="large" class="mt-1" @click="add">
          {{ $t('Add') }}
        </v-btn>
      </div>
    </settings-section>

    <settings-section
      :title="$t('Preferred quality')"
      :hint="$t('Which copy to reach for when Ventic picks one for you. It is a preference and not a filter: a tier with nothing worth streaming in it falls through to the next, so asking for 4K on a title that has none still plays the best 1080p.')"
    >
      <settings-segment v-model="settings.quality" :options="QUALITIES" />
      <p class="text-body-small opacity-70">
        {{ $t('A copy far lighter than the others of its own size, or with too few seeders to keep up, is ranked as the tier below — that is the 1080p that is 1080p by label alone.') }}
      </p>
    </settings-section>

    <settings-section
      :title="$t('Live TV')"
      :hint="$t('Channels come from an M3U playlist — the file every IPTV subscription and every public channel index hands out. Paste its link here and the channels appear under Live TV. An Xtream server counts: its get.php address is an M3U, so paste that.')"
    >
      <v-list v-if="settings.playlists.length" bg-color="transparent" class="rounded-lg bg-surface-container/40">
        <!-- The name, not the URL. An Xtream playlist carries the account's
             password in its query string, and this list gets read across a
             room. -->
        <v-list-item v-for="value in settings.playlists" :key="value" :title="playlistName(value)">
          <template #append>
            <v-btn icon size="small" variant="text" color="on-surface" @click="removePlaylist(value)">
              <v-icon :icon="mdiDeleteOutline" size="20" />
              <v-tooltip activator="parent" :text="$t('Remove this playlist')" />
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <div v-else class="flex flex-col items-center gap-2 rounded-lg bg-surface-container/40 px-4 py-10 text-center">
        <v-icon :icon="mdiTelevisionPlay" size="32" class="opacity-40" />
        <p class="text-body-medium opacity-70">
          {{ $t('No playlists yet. Live TV stays empty until you add one — the app comes with no channels and suggests none.') }}
        </p>
      </div>

      <div class="flex items-start gap-2">
        <v-text-field
          v-model="playlist"
          :label="$t('Playlist URL')"
          placeholder="https://…"
          variant="solo-filled"
          density="comfortable"
          rounded="lg"
          flat
          :error-messages="playlistError"
          @keydown.enter="addPlaylist"
          @update:model-value="playlistError = ''"
        />
        <v-btn :prepend-icon="mdiPlus" variant="tonal" size="large" class="mt-1" @click="addPlaylist">
          {{ $t('Add') }}
        </v-btn>
      </div>

      <p class="text-body-small opacity-70">
        {{ $t('A playlist link usually contains your account details, so it is kept out of backups. Channels are read once per launch — Reload on the Live TV page fetches a playlist that has changed.') }}
      </p>
    </settings-section>

    <settings-section
      :title="$t('Adding by link')"
      :hint="$t('A page can offer a ventic:// link that opens the app with a source ready to add. The app always asks first — a link can never change what Ventic searches on its own.')"
    >
      <v-switch
        v-model="stremioLinks"
        :loading="stremioBusy"
        color="primary"
        density="comfortable"
        hide-details
        :label="$t('Also handle stremio:// links')"
        @update:model-value="toggleStremio"
      />
      <p class="text-body-small opacity-70">
        <i18n-t keypath="Addon pages publish {link} install links. Turning this on points them at Ventic. Leave it off if you also use Stremio — only one app can own the scheme, and this would take it." tag="span">
          <template #link>
            <code>stremio://</code>
          </template>
        </i18n-t>
      </p>
    </settings-section>

    <!-- A link arrived. Show what it is, in full, before anything is added. -->
    <v-dialog :model-value="!!pending" max-width="560" persistent>
      <v-card rounded="xl">
        <v-card-title class="text-title-medium">
          {{ $t('Add this source?') }}
        </v-card-title>
        <v-card-text class="flex flex-col gap-3">
          <p class="text-body-medium">
            {{ $t('A link asked Ventic to start searching:') }}
          </p>
          <code class="break-all rounded-lg bg-surface-container-high px-3 py-2 text-body-small">{{ pending }}</code>
          <p class="text-body-small opacity-70">
            {{ $t('Ventic will send it the title you\'re looking for and play what it hands back. Only add servers you trust — this one is not run by, or checked by, this app.') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="ui.pendingSource = ''">
            {{ $t('Cancel') }}
          </v-btn>
          <v-btn variant="tonal" color="primary" @click="confirmPending">
            {{ $t('Add source') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <settings-section
      :title="$t('What a source has to speak')"
      :hint="$t('Any server implementing the Stremio addon protocol works — it is an open protocol with several independent implementations, and Ventic runs no code from a source, only reads its answer.')"
    >
      <p class="text-body-small opacity-70">
        <i18n-t keypath="Ventic asks a source for {movie}, or {series}, and expects a {streams} array back. Add several and their results are merged, with duplicates dropped and earlier sources preferred." tag="span">
          <template #movie>
            <code>/stream/movie/&lt;imdb-id&gt;.json</code>
          </template>
          <template #series>
            <code>/stream/series/&lt;imdb-id&gt;:&lt;season&gt;:&lt;episode&gt;.json</code>
          </template>
          <template #streams>
            <code>streams</code>
          </template>
        </i18n-t>
      </p>
      <p class="text-body-small opacity-70">
        {{ $t('The project does not host, run, endorse or recommend any source, and does not distribute a list of them.') }}
      </p>
    </settings-section>
  </div>
</template>
