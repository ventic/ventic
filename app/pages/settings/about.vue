<script setup lang="ts">
import { mdiOpenInNew, mdiUpdate } from '@mdi/js'

const settings = useSettingsStore()
const updates = useUpdatesStore()

// Naming the licence is half the point of this list. Windows builds carry an
// mpv.exe, which makes handing one out redistribution of GPL software — the
// notice and offer of source ride along beside it (see scripts/build/mpv.ts).
const credits = computed(() => [
  { title: 'mpv', text: $t('The player itself — decoding, subtitles and audio. GPLv2 or later.'), url: 'https://mpv.io' },
  { title: 'librqbit', text: $t('The torrent engine, embedded in the app. MIT licensed.'), url: 'https://github.com/ikatson/rqbit' },
  { title: 'OpenSubtitles', text: $t('Subtitles, reached through public addons Stremio operates.'), url: 'https://www.opensubtitles.org' },
])

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
            {{ $t('Version {version}', { version: updates.current || $t('unknown') }) }}
          </div>
          <div class="text-body-small opacity-70">
            {{ $t('A media library and BitTorrent player, on the desktop and on Android TV.') }}
            <template v-if="updates.platform">
              · {{ updates.platform }}
            </template>
          </div>
        </div>
      </div>
    </settings-section>

    <settings-section :title="$t('Updates')">
      <template v-if="updates.available">
        <p class="text-body-medium">
          {{ $t('Ventic {version} is out', { version: updates.available.version }) }}
        </p>

        <!-- The same panel the launch dialog shows, so there is one state
             machine and not two. Only the way out differs: nothing here needs a
             "not now" — the user came to this page on purpose — but skipping
             the version has to stay reachable, since it is what takes the badge
             off the toolbar. -->
        <update-panel>
          <template #dismiss>
            <v-btn v-if="!updates.dismissed" variant="text" @click="updates.skip()">
              {{ $t('Skip this version') }}
            </v-btn>
          </template>
        </update-panel>
      </template>

      <template v-else>
        <p class="text-body-medium opacity-70">
          {{ updates.current ? $t('Ventic is up to date.') : $t('Updates are checked in the installed app, not here.') }}
        </p>
        <div>
          <v-btn
            :prepend-icon="mdiUpdate"
            :loading="updates.status === 'checking'"
            variant="tonal"
            size="small"
            @click="updates.check()"
          >
            {{ $t('Check again') }}
          </v-btn>
        </div>
      </template>

      <p class="text-body-small opacity-70">
        {{ $t('Checked once each time Ventic starts, against this project\'s GitHub releases. Nothing else is sent — there is no account and no telemetry behind it.') }}
      </p>
    </settings-section>

    <settings-section :title="$t('Film and TV data')">
      <!-- TMDB's terms: their logo, and a plain statement that they haven't
           endorsed any of this. Both have to stay. -->
      <img src="/tmdb.svg" alt="The Movie Database" class="h-5 w-auto self-start">
      <!-- TMDB require this sentence verbatim, so it is not translated. -->
      <p class="text-body-medium">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
      <p class="text-body-small opacity-70">
        {{ $t('Every poster, backdrop, cast list, rating and synopsis in the app comes from The Movie Database.') }}
      </p>
      <div>
        <v-btn :append-icon="mdiOpenInNew" variant="tonal" size="small" @click="open('https://www.themoviedb.org')">
          themoviedb.org
        </v-btn>
      </div>

      <!-- The way back from a revoked bundled token without shipping a release.
           Empty is the normal state — nobody should need this to use the app. -->
      <tv-field :label="$t('Your own TMDB read token')">
        <v-text-field
          v-model.trim="settings.tmdbKey"
          :label="$t('Your own TMDB read token')"
          :placeholder="$t('Leave empty to use the built-in one')"
          variant="solo-filled"
          density="comfortable"
          rounded="lg"
          flat
          autocomplete="off"
          spellcheck="false"
          :hint="$t('Only needed if the app stops loading artwork and titles. Create one free under your TMDB account settings, API, “API Read Access Token”. It is kept out of backup files.')"
          persistent-hint
        />
      </tv-field>
    </settings-section>

    <settings-section :title="$t('Built on')">
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

    <settings-section :title="$t('Legal')">
      <p class="text-body-medium">
        {{ $t('Ventic hosts no content, indexes no content, and ships with no sources configured. It is a BitTorrent client with a player attached: it fetches only what you point it at, from servers you added yourself.') }}
      </p>
      <p class="text-body-small opacity-70">
        {{ $t('Copyright in what you play is unaffected by the tool you play it with. Whether you have the right to download a given title is yours to answer, under the law where you are. Reports about a source belong with whoever operates it — the project has no control over, and no relationship with, any of them.') }}
      </p>
      <p class="text-body-small opacity-70">
        {{ $t('Ventic is MIT licensed. The components it is built on keep their own terms, listed above; on Windows the bundled mpv is GPL software and its licence and offer of source sit next to the application\'s executable.') }}
      </p>

      <!-- Linked rather than restated: one copy of the policy, on the site,
           where an edit to it is visible in public history. Store listings
           point at the same URL. -->
      <p class="text-body-small opacity-70">
        {{ $t('Ventic collects nothing about you: no account, no telemetry, no crash reports and no server to send them to. The privacy policy lists every request the app makes and every permission it asks for.') }}
      </p>
      <div>
        <v-btn :append-icon="mdiOpenInNew" variant="tonal" size="small" @click="open('https://ventic.tv/privacy')">
          {{ $t('Privacy policy') }}
        </v-btn>
      </div>
    </settings-section>
  </div>
</template>
