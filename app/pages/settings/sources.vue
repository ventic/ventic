<script setup lang="ts">
import { mdiDeleteOutline, mdiInformationOutline, mdiPencilOutline, mdiPlus, mdiPowerPlugOutline, mdiTelevisionPlay } from '@mdi/js'
import { invoke } from '@tauri-apps/api/core'

/**
 * Where the app is allowed to look for something to play. Ventic ships with
 * this list empty and never adds to it on its own: a source is a server
 * someone else runs, and adding one is the user's decision to make.
 */
const settings = useSettingsStore()

const url = ref('')
const error = ref('')

/** What is wrong with `value` as a source, or '' — `current` being the one it replaces. */
function problem(value: string, current = '') {
  if (!value)
    return $t('That doesn\'t look like a URL. Paste an addon link, or one starting with https://')
  if (value !== current && settings.sources.includes(value))
    return $t('That source is already in the list.')
  return ''
}

function add() {
  if (!url.value.trim())
    return

  // Takes whatever the user copied — a stremio:// link, a manifest URL, a bare
  // origin — and reduces it to the base the search appends to.
  const value = normalizeSource(url.value)
  error.value = problem(value)
  if (error.value)
    return

  // New arrays rather than a push: localStorage and the search watcher see them.
  // Adding is also switching on — a sync can leave a removed source's "off"
  // behind, and it would otherwise come back already off.
  settings.sources = [...settings.sources, value]
  settings.disabledSources = settings.disabledSources.filter(s => s !== value)
  url.value = ''
}

function remove(value: string) {
  settings.sources = settings.sources.filter(s => s !== value)
  settings.disabledSources = settings.disabledSources.filter(s => s !== value)
}

const off = computed(() => new Set(settings.disabledSources))

function setEnabled(value: string, on: boolean | null) {
  const rest = settings.disabledSources.filter(s => s !== value)
  settings.disabledSources = on ? rest : [...rest, value]
}

/** The host is what tells sources apart at a glance; a configured addon's path is a blob. */
function hostOf(value: string) {
  try {
    return new URL(value).host
  }
  catch {
    return value
  }
}

/**
 * Editing changes a source in place rather than removing and re-adding it,
 * because the list is an order — earlier sources win a duplicate — and a
 * configured addon's settings live in its URL, so this is where they change.
 */
const editing = ref('')
const draft = ref('')
const editError = ref('')
let opener: HTMLElement | null = null

function edit(value: string) {
  editing.value = value
  draft.value = value
  editError.value = ''
  // Back on the row's pencil afterwards, not at the top of the page.
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function refocus() {
  if (opener?.isConnected)
    opener.focus({ preventScroll: true })
  opener = null
}

function save() {
  const value = normalizeSource(draft.value)
  editError.value = problem(value, editing.value)
  if (editError.value)
    return
  const swap = (s: string) => s === editing.value ? value : s
  settings.sources = settings.sources.map(swap)
  settings.disabledSources = settings.disabledSources.map(swap)
  editing.value = ''
}

// --- Live TV ------------------------------------------------------------------

/**
 * A playlist is not a source and is kept apart from one: a source answers the
 * addon protocol for a title you looked up, a playlist is a file of channels
 * (see utils/iptv). Same rule though — the app ships with none and names none.
 */
const playlist = ref('')
const playlistError = ref('')

/**
 * Most subscriptions arrive as a server, a username and a password rather than
 * a link, so that is a form of its own — which stores the same kind of string
 * the link box does (see `xtreamUrl`).
 */
const PLAYLIST_KINDS = [
  { value: 'm3u', title: () => $t('Playlist link') },
  { value: 'xtream', title: () => $t('Xtream login') },
] as const
const kind = ref<'m3u' | 'xtream'>('m3u')
const xtream = reactive({ server: '', username: '', password: '' })
const showXtreamPassword = ref(false)

watch(kind, () => playlistError.value = '')

function addPlaylist() {
  let value: string | null
  if (kind.value === 'xtream') {
    if (!xtream.server.trim())
      return
    value = xtreamUrl(xtream.server, xtream.username, xtream.password)
    if (!value) {
      playlistError.value = $t('An Xtream login needs the server address, a username and a password.')
      return
    }
  }
  else {
    if (!playlist.value.trim())
      return
    // `httpUrl` and not a test of our own: what a phone sends to this same list
    // goes through it (`setupValue` in utils/cast.ts), and a box that accepts
    // what the phone refuses is two rules where there is meant to be one.
    value = httpUrl(playlist.value)
    if (!value) {
      playlistError.value = $t('A playlist is an http:// or https:// link to an M3U file.')
      return
    }
  }
  if (settings.playlists.includes(value)) {
    playlistError.value = $t('That playlist is already in the list.')
    return
  }
  settings.playlists = [...settings.playlists, value]
  playlist.value = ''
  Object.assign(xtream, { server: '', username: '', password: '' })
  playlistError.value = ''
}

function removePlaylist(value: string) {
  settings.playlists = settings.playlists.filter(p => p !== value)
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

// `unknown` because that is what a switch emits since Vuetify 4.3 — whatever its
// `true-value` is; this one has none, so it is a boolean in practice.
async function toggleStremio(on: unknown) {
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
      :keywords="$t('addon, add-on, provider, indexer, Stremio, manifest, search results')"
    >
      <!-- Naming the protocol is what makes the empty box answerable: a user who
           knows the word can find an addon in one search. Naming a particular
           addon would make this project the one distributing the link. -->
      <v-alert variant="tonal" density="comfortable" rounded="lg" class="text-body-medium">
        <template #prepend>
          <v-icon :icon="mdiInformationOutline" />
        </template>
        <!-- i18n-t rather than $t: the sentence has markup inside it, and the
             two <code> spans are literal syntax a translator must not touch.
             `scope="global"` because there is no other: left to look for a
             component's own catalog, it warns on every render that it found
             none. -->

        <i18n-t keypath="Ventic speaks the {protocol}. Any Stremio addon URL works here — paste the {link} link or the {manifest} address and it'll be trimmed to what's needed." tag="span" scope="global">
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
        <v-list-item v-for="value in settings.sources" :key="value">
          <!-- Dimmed as well as switched: the switch alone is a small thing to
               read across a room. -->
          <template #title>
            <span :class="{ 'opacity-50': off.has(value) }">{{ hostOf(value) }}</span>
          </template>
          <template #subtitle>
            <!-- break-all: a configured URL is one long word, which otherwise
                 wraps at its first hyphen and leaves the clamped line empty. -->
            <span class="break-all" :class="{ 'opacity-50': off.has(value) }">{{ off.has(value) ? $t('Off — not searched') : value }}</span>
          </template>
          <template #append>
            <div class="flex items-center gap-1">
              <v-switch
                :model-value="!off.has(value)"
                :aria-label="$t('Search this source')"
                color="primary"
                density="compact"
                hide-details
                class="mr-2"
                @update:model-value="setEnabled(value, $event)"
              />
              <v-btn icon size="small" variant="text" color="on-surface" @click="edit(value)">
                <v-icon :icon="mdiPencilOutline" size="20" />
                <v-tooltip activator="parent" :text="$t('Edit this source')" />
              </v-btn>
              <v-btn icon size="small" variant="text" color="on-surface" @click="remove(value)">
                <v-icon :icon="mdiDeleteOutline" size="20" />
                <v-tooltip activator="parent" :text="$t('Remove this source')" />
              </v-btn>
            </div>
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
        <tv-field :label="$t('Source URL')" class="flex-1">
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
        </tv-field>
        <v-btn :prepend-icon="mdiPlus" variant="tonal" size="large" class="mt-1" @click="add">
          {{ $t('Add') }}
        </v-btn>
      </div>
    </settings-section>

    <v-dialog :model-value="!!editing" max-width="640" @update:model-value="editing = ''" @after-leave="refocus">
      <v-card v-if="editing" rounded="xl" :title="$t('Edit source')">
        <v-card-text class="flex flex-col gap-3">
          <tv-field :label="$t('Source URL')">
            <!-- A textarea that grows, because a configured addon's URL is a
                 few hundred characters and a one-line field shows a slice of
                 it. Enter still saves: a URL has no line breaks to type. -->
            <v-textarea
              v-model="draft"
              :label="$t('Source URL')"
              variant="outlined"
              rows="1"
              auto-grow
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              class="font-mono"
              :error-messages="editError"
              @keydown.enter.prevent="save"
              @update:model-value="editError = ''"
            />
          </tv-field>
          <p class="text-body-small opacity-70">
            {{ $t('An addon you configured on its own page keeps those settings in this address. Configure it again there and paste the new link here — it keeps its place in the list.') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editing = ''">
            {{ $t('Cancel') }}
          </v-btn>
          <v-btn variant="tonal" color="primary" @click="save">
            {{ $t('Save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <settings-section
      :title="$t('Preferred quality')"
      :hint="$t('Which copy to reach for when Ventic picks one for you. It is a preference and not a filter: a tier with nothing worth streaming in it falls through to the next, so asking for 4K on a title that has none still plays the best 1080p.')"
      :keywords="$t('resolution, 4K, UHD, 2160p, 1080p, Full HD, 720p, HD, bitrate, default quality')"
    >
      <settings-segment v-model="settings.quality" :options="QUALITIES" />
      <p class="text-body-small opacity-70">
        {{ $t('A copy far lighter than the others of its own size, or with too few seeders to keep up, is ranked as the tier below — that is the 1080p that is 1080p by label alone.') }}
      </p>
    </settings-section>

    <settings-section
      :title="$t('Live TV')"
      :hint="$t('Channels come from an M3U playlist — the file every IPTV subscription and every public channel index hands out — or from the server, username and password an Xtream subscription sends. Add either here and the channels appear under Live TV.')"
      :keywords="$t('IPTV, M3U, M3U8, Xtream Codes, channels, television, playlist')"
    >
      <v-list v-if="settings.playlists.length" bg-color="transparent" class="rounded-lg bg-surface-container/40">
        <!-- The name, not the URL. An Xtream playlist carries the account's
             password in its query string, and this list gets read across a
             room. -->
        <v-list-item
          v-for="value in settings.playlists"
          :key="value"
          :title="playlistName(value)"
          :subtitle="isXtream(value) ? $t('Xtream login') : undefined"
        >
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

      <settings-segment v-model="kind" :options="PLAYLIST_KINDS" inline />

      <template v-if="kind === 'xtream'">
        <div class="flex flex-wrap gap-3">
          <tv-field :label="$t('Server')" class="min-w-56 flex-[2]">
            <v-text-field
              v-model="xtream.server"
              :label="$t('Server')"
              placeholder="http://…:8080"
              persistent-placeholder
              variant="solo-filled"
              density="comfortable"
              rounded="lg"
              flat
              hide-details
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              @update:model-value="playlistError = ''"
            />
          </tv-field>
          <tv-field :label="$t('Username')" class="min-w-44 flex-1">
            <v-text-field
              v-model="xtream.username"
              :label="$t('Username')"
              variant="solo-filled"
              density="comfortable"
              rounded="lg"
              flat
              hide-details
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              @update:model-value="playlistError = ''"
            />
          </tv-field>
          <tv-field :label="$t('Password')" class="min-w-44 flex-1">
            <v-text-field
              v-model="xtream.password"
              :label="$t('Password')"
              :type="showXtreamPassword ? 'text' : 'password'"
              variant="solo-filled"
              density="comfortable"
              rounded="lg"
              flat
              hide-details
              @keydown.enter="addPlaylist"
              @update:model-value="playlistError = ''"
            />
          </tv-field>
        </div>
        <p v-if="playlistError" class="text-body-small text-error">
          {{ playlistError }}
        </p>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <!-- A checkbox rather than an eye inside the field, as on the sync
               login: one less thing for a d-pad crossing the row to fall into. -->
          <v-checkbox v-model="showXtreamPassword" density="compact" hide-details :label="$t('Show password')" />
          <v-btn :prepend-icon="mdiPlus" variant="tonal" size="large" @click="addPlaylist">
            {{ $t('Add') }}
          </v-btn>
        </div>
      </template>

      <div v-else class="flex items-start gap-2">
        <tv-field :label="$t('Playlist URL')" class="flex-1">
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
        </tv-field>
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
      :keywords="$t('deep link, URL scheme, protocol handler, install link, one-click install')"
    >
      <v-switch
        v-model="stremioLinks"
        :loading="stremioBusy"
        color="primary"
        density="comfortable"
        hide-details
        :label="$t('Also handle stremio:// links')"
        @update:model-value="toggleStremio"
      >
        <template #description>
          <i18n-t keypath="Addon pages publish {link} install links. Turning this on points them at Ventic. Leave it off if you also use Stremio — only one app can own the scheme, and this would take it." tag="span" scope="global">
            <template #link>
              <code>stremio://</code>
            </template>
          </i18n-t>
        </template>
      </v-switch>
    </settings-section>

    <settings-section
      :title="$t('What a source has to speak')"
      :hint="$t('Any server implementing the Stremio addon protocol works — it is an open protocol with several independent implementations, and Ventic runs no code from a source, only reads its answer.')"
      :keywords="$t('protocol, API, developer, specification')"
    >
      <p class="text-body-small opacity-70">
        <i18n-t keypath="Ventic asks a source for {movie}, or {series}, and expects a {streams} array back. Add several and their results are merged, with duplicates dropped and earlier sources preferred." tag="span" scope="global">
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
