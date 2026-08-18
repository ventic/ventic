<script setup lang="ts">
import { mdiCoffee, mdiOpenInNew, mdiRestart, mdiTrayArrowDown, mdiUpdate } from '@mdi/js'

const settings = useSettingsStore()
const updates = useUpdatesStore()
const platform = ref('')

onMounted(() => {
  // Throws synchronously rather than rejecting when there is no Tauri at all,
  // which is every `bun run dev` browser session. The version comes from the
  // updates store, which needs it anyway to know whether it is behind.
  try {
    platform.value = useTauriOsPlatform()
  }
  catch {}
})

/**
 * Where "get it yourself" points when this copy can't replace itself. Android is
 * the one platform with a single obvious file — the APK on the release — so it
 * gets a direct link; everywhere else the release page is the honest answer,
 * because which of the six bundles is the right one is the user's call.
 */
const downloadUrl = computed(() =>
  (platform.value === 'android' && updates.available?.apk) || updates.available?.url || RELEASES_URL)

// Naming the licence is half the point of this list. Windows builds carry an
// mpv.exe, which makes handing one out redistribution of GPL software — the
// notice and offer of source ride along beside it (see scripts/build/mpv.ts).
const credits = [
  { title: 'mpv', text: 'The player itself — decoding, subtitles and audio. GPLv2 or later.', url: 'https://mpv.io' },
  { title: 'librqbit', text: 'The torrent engine, embedded in the app. MIT licensed.', url: 'https://github.com/ikatson/rqbit' },
  { title: 'OpenSubtitles', text: 'Subtitles, reached through public addons Stremio operates.', url: 'https://www.opensubtitles.org' },
]

// Same escape hatch as the trailer button: the shell plugin has no Android
// implementation and fails with ENOENT looking for `xdg-open`, so a link there
// would otherwise do nothing at all.
function open(url: string) {
  useTauriShellOpen(url).catch(() => window.open(url, '_blank'))
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section title="Ventic">
      <div class="flex items-center gap-4">
        <img src="/logo.svg" alt="" class="size-14">
        <div>
          <div class="text-title-medium">
            Version {{ updates.current || 'unknown' }}
          </div>
          <div class="text-body-small opacity-70">
            A media library and BitTorrent player, on the desktop and on Android TV.
            <template v-if="platform">
              · {{ platform }}
            </template>
          </div>
        </div>
      </div>
    </settings-section>

    <settings-section title="Updates">
      <!-- Three outcomes, and which one shows has nothing to do with which
           platform this is: `capable` is about how the app was *installed*.
           See can_self_update in src-tauri/src/lib.rs. -->
      <template v-if="updates.available">
        <p class="text-body-medium">
          Ventic {{ updates.available.version }} is out.
        </p>

        <!-- The release body, as GitHub markdown. Nothing renders it and nothing
             should: a markdown dependency for the one screen that shows release
             notes is a poor trade, and the notes read fine as text. -->
        <pre
          v-if="updates.available.notes"
          class="text-body-small max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-container/40 p-4 font-sans opacity-80"
        >{{ updates.available.notes }}</pre>

        <p v-if="!updates.capable && platform === 'android'" class="text-body-medium opacity-70">
          Android installs from the package itself — download it and open it. It is signed
          with the same key as the copy you have, so it upgrades in place and keeps your
          library.
        </p>
        <p v-else-if="!updates.capable" class="text-body-medium opacity-70">
          This copy wasn't installed by Ventic's own installer — a package manager, or a
          build from source — so whatever put it there is what updates it. Replacing the
          files from in here would only confuse it.
        </p>

        <!-- Failing over to the download link rather than dead-ending: the
             manifest can be missing this platform even when everything else
             about the install is fine. -->
        <p v-if="updates.status === 'failed'" class="text-body-medium text-error">
          The update couldn't be installed: {{ updates.error }}
        </p>

        <v-progress-linear
          v-if="updates.status === 'downloading'"
          :model-value="updates.progress * 100"
          :indeterminate="!updates.progress"
          color="primary"
          rounded
          height="6"
        />

        <div class="flex flex-wrap items-center gap-2">
          <v-btn
            v-if="updates.status === 'ready'"
            :prepend-icon="mdiRestart"
            variant="flat"
            color="primary"
            @click="updates.restart()"
          >
            Restart to finish
          </v-btn>
          <v-btn
            v-else-if="updates.capable"
            :prepend-icon="mdiUpdate"
            :loading="updates.status === 'downloading'"
            variant="flat"
            color="primary"
            @click="updates.install()"
          >
            Update now
          </v-btn>
          <v-btn
            v-if="!updates.capable || updates.status === 'failed'"
            :prepend-icon="platform === 'android' ? mdiTrayArrowDown : mdiOpenInNew"
            variant="tonal"
            @click="open(downloadUrl)"
          >
            {{ platform === 'android' ? 'Download the APK' : 'Open the release' }}
          </v-btn>
          <v-btn
            v-if="updates.status !== 'downloading' && updates.status !== 'ready' && !updates.dismissed"
            variant="text"
            @click="updates.dismiss()"
          >
            Not now
          </v-btn>
        </div>

        <p v-if="updates.status === 'ready'" class="text-body-small opacity-70">
          Installed. It takes effect the next time Ventic starts.
        </p>
      </template>

      <template v-else>
        <p class="text-body-medium opacity-70">
          {{ updates.current ? 'Ventic is up to date.' : 'Updates are checked in the installed app, not here.' }}
        </p>
        <div>
          <v-btn
            :prepend-icon="mdiUpdate"
            :loading="updates.status === 'checking'"
            variant="tonal"
            size="small"
            @click="updates.check()"
          >
            Check again
          </v-btn>
        </div>
      </template>

      <p class="text-body-small opacity-70">
        Checked once each time Ventic starts, against this project's GitHub releases.
        Nothing else is sent — there is no account and no telemetry behind it.
      </p>
    </settings-section>

    <settings-section title="Film and TV data">
      <!-- TMDB's terms: their logo, and a plain statement that they haven't
           endorsed any of this. Both have to stay. -->
      <img src="/tmdb.svg" alt="The Movie Database" class="h-5 w-auto self-start">
      <p class="text-body-medium">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
      <p class="text-body-small opacity-70">
        Every poster, backdrop, cast list, rating and synopsis in the app comes from
        The Movie Database.
      </p>
      <div>
        <v-btn :append-icon="mdiOpenInNew" variant="tonal" size="small" @click="open('https://www.themoviedb.org')">
          themoviedb.org
        </v-btn>
      </div>

      <!-- The way back from a revoked bundled token without shipping a release.
           Empty is the normal state — nobody should need this to use the app. -->
      <v-text-field
        v-model.trim="settings.tmdbKey"
        label="Your own TMDB read token"
        placeholder="Leave empty to use the built-in one"
        variant="solo-filled"
        density="comfortable"
        rounded="lg"
        flat
        autocomplete="off"
        spellcheck="false"
        hint="Only needed if the app stops loading artwork and titles. Create one free under your TMDB account settings, API, “API Read Access Token”. It is kept out of backup files."
        persistent-hint
      />
    </settings-section>

    <settings-section title="Built on">
      <v-list bg-color="transparent" class="rounded-lg bg-surface-container/40">
        <v-list-item
          v-for="item in credits"
          :key="item.title"
          :title="item.title"
          :subtitle="item.text"
          :append-icon="mdiOpenInNew"
          @click="open(item.url)"
        />
      </v-list>
    </settings-section>

    <settings-section title="Support">
      <p class="text-body-small opacity-70">
        Ventic is free and always will be. If it earned one, you can buy me a coffee.
      </p>
      <div>
        <v-btn :prepend-icon="mdiCoffee" variant="tonal" size="small" @click="open('https://buymeacoffee.com/tilenpirih')">
          Buy me a coffee
        </v-btn>
      </div>
    </settings-section>

    <settings-section title="Legal">
      <p class="text-body-medium">
        Ventic hosts no content, indexes no content, and ships with no sources configured.
        It is a BitTorrent client with a player attached: it fetches only what you point it
        at, from servers you added yourself.
      </p>
      <p class="text-body-small opacity-70">
        Copyright in what you play is unaffected by the tool you play it with. Whether you
        have the right to download a given title is yours to answer, under the law where you
        are. Reports about a source belong with whoever operates it — the project has no
        control over, and no relationship with, any of them.
      </p>
      <p class="text-body-small opacity-70">
        Ventic is MIT licensed. The components it is built on keep their own terms, listed
        above; on Windows the bundled mpv is GPL software and its licence and offer of
        source sit next to the application's executable.
      </p>
    </settings-section>
  </div>
</template>
