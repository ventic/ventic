<script setup lang="ts">
import { mdiOpenInNew } from '@mdi/js'

const version = ref('')
const platform = ref('')

onMounted(async () => {
  // Both fail in a browser-only dev session, where there is no Tauri at all —
  // and `platform` throws synchronously rather than rejecting.
  try {
    version.value = await useTauriAppGetVersion()
    platform.value = useTauriOsPlatform()
  }
  catch {}
})

// Naming the licence is half the point of this list. Windows builds carry an
// mpv.exe, which makes handing one out redistribution of GPL software — the
// notice and offer of source ride along beside it (see scripts/mpv.ts).
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
            Version {{ version || 'unknown' }}
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
