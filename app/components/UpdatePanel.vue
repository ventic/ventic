<script setup lang="ts">
import { mdiOpenInNew, mdiRestart, mdiTrayArrowDown, mdiUpdate } from '@mdi/js'

/**
 * Everything the app has to say about a release that is out, and everything
 * this copy can do about it — the whole road from "here it is" to "restart to
 * finish", including the three ways it can end badly.
 *
 * One component because there are two places that show it and one state machine
 * behind both: the About panel, which the user went looking for, and the dialog
 * that comes looking for them. Only the way *out* differs, so that is the bit
 * the parent supplies, through `#dismiss`.
 */
const updates = useUpdatesStore()

const android = computed(() => updates.platform === 'android')

/**
 * Where "get it yourself" points when this copy can't replace itself — a `.deb`,
 * an AUR build, a browser, or an Android box whose installer wouldn't take our
 * APK. The project's own download page rather than the GitHub release, which is
 * a list of six files with no word about which one this machine wants.
 */
const downloadUrl = computed(() =>
  (android.value && (updates.available?.apk || APK_URL)) || DOWNLOAD_URL)

/**
 * The changelog, which is every release between the one running and the newest
 * — a user four versions behind is owed the four sets of notes, not the one
 * they happened to be online for.
 *
 * Rendered here rather than in the template, where the parser would run again
 * on every unrelated re-render.
 */
const sections = computed(() => updates.missed.map(release => ({
  version: release.version,
  date: dateText(release.date),
  html: renderNotes(release.notes),
})))

// Same escape hatch as the trailer button: the shell plugin has no Android
// implementation and fails with ENOENT looking for `xdg-open`, so a link there
// would otherwise do nothing at all.
function open(url: string) {
  useTauriShellOpen(url).catch(() => window.open(url, '_blank'))
}
</script>

<template>
  <div v-if="updates.available" class="flex flex-col gap-4">
    <!-- Which of these shows has nothing to do with the platform on the desktop:
         `capable` is about how the app was *installed* (can_self_update in
         src-tauri/src/lib.rs). Android is the exception — `apk` there means the
         bridge can fetch the package and hand it to the system installer, which
         is the whole update. -->
    <p v-if="updates.apk" class="text-body-medium opacity-70">
      {{ $t('Ventic downloads the new package and Android asks you to confirm the install. It is signed with the same key as the copy you have, so it upgrades in place and keeps your library.') }}
    </p>
    <p v-else-if="!updates.canUpdate && android" class="text-body-medium opacity-70">
      {{ $t('Android installs from the package itself — download it and open it. It is signed with the same key as the copy you have, so it upgrades in place and keeps your library.') }}
    </p>
    <p v-else-if="!updates.canUpdate" class="text-body-medium opacity-70">
      {{ $t('This copy wasn\'t installed by Ventic\'s own installer — a package manager, or a build from source — so whatever put it there is what updates it. Replacing the files from in here would only confuse it.') }}
    </p>

    <!-- Failing over to the download link rather than dead-ending: the manifest
         can be missing this platform even when everything else about the
         install is fine. -->
    <p v-if="updates.status === 'failed'" class="text-body-medium text-error">
      {{ $t('The update couldn\'t be installed: {error}', { error: updates.error }) }}
    </p>

    <v-progress-linear
      v-if="updates.status === 'downloading'"
      :model-value="updates.progress * 100"
      :indeterminate="!updates.progress"
      color="primary"
      rounded
      height="6"
    />

    <!-- Above the changelog, not below it. Four missed releases is a screen and
         a half of prose, and a dialog whose Update button is off the bottom of
         it is a dialog nobody can answer without scrolling first — worse on a
         remote, where scrolling is a held-down arrow. It is also what the
         tv-remote-ui skill asks for: the primary action early in the DOM, which
         is where the d-pad picks it up. -->
    <div class="flex flex-wrap items-center gap-2">
      <v-btn
        v-if="updates.status === 'ready'"
        :prepend-icon="mdiRestart"
        variant="flat"
        color="primary"
        @click="updates.restart()"
      >
        {{ $t('Restart to finish') }}
      </v-btn>
      <v-btn
        v-else-if="updates.canUpdate"
        :prepend-icon="mdiUpdate"
        :loading="updates.status === 'downloading'"
        variant="flat"
        color="primary"
        @click="updates.install()"
      >
        {{ $t('Update now') }}
      </v-btn>
      <v-btn
        v-if="!updates.canUpdate || updates.status === 'failed'"
        :prepend-icon="android ? mdiTrayArrowDown : mdiOpenInNew"
        variant="tonal"
        @click="open(downloadUrl)"
      >
        {{ android ? $t('Download the APK') : $t('Open the download page') }}
      </v-btn>

      <!-- Putting it off stops being an option once it is under way: there is
           nothing left to defer, and a button beside a running download reads
           as the cancel it isn't. -->
      <slot v-if="!updates.busy" name="dismiss" />
    </div>

    <p v-if="updates.status === 'ready'" class="text-body-small opacity-70">
      {{ $t('Installed. It takes effect the next time Ventic starts.') }}
    </p>
    <p v-else-if="updates.status === 'installing'" class="text-body-small opacity-70">
      {{ $t('Downloaded. Confirm the install when Android asks — Ventic closes while it happens.') }}
    </p>

    <!-- Everything missed, newest first, and two decisions about how a remote
         gets through it. Both were found by walking the dialog with the d-pad,
         not by reading it: the markup looks correct either way.

         No scrollbar of its own. `nudge()` scrolls by walking up from whatever
         is focused (plugins/dpad.client.ts), so an inner `overflow-y` here is a
         box nothing outside it can move; left to grow, the ancestor scrolls —
         the dialog's card, or the settings page — and both enclose the buttons.

         And `tabindex` because of what `nudge` does *after* it scrolls: it drops
         focus, and the next press then starts from `<body>`, where `focusFirst`
         needs something inside the dialog that is still on screen. With the
         buttons scrolled off the top and nothing focusable in here, there was
         nothing — one press scrolled the notes and every press after it did
         nothing at all. It is the scroll region, so it is also the target.

         What is *not* focusable is anything inside: `renderNotes` writes no
         links, so this is one stop and not a changelog of them. -->
    <div v-if="sections.length" tabindex="0" class="flex flex-col gap-5 rounded-lg bg-surface-container/40 p-4">
      <section v-for="section in sections" :key="section.version" class="flex flex-col gap-1">
        <h3 class="text-title-small">
          {{ section.version }}
          <span v-if="section.date" class="font-normal opacity-60">· {{ section.date }}</span>
        </h3>
        <!-- Safe by construction rather than by trust: `renderNotes` escapes
             first and writes no attributes at all. See it in utils/updates.ts. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="section.html" class="notes text-body-medium opacity-80" v-html="section.html" />
      </section>
    </div>
  </div>
</template>

<style scoped>
/* The markup `renderNotes` writes, and nothing else — seven tags, no classes,
   because the parser deliberately emits no attributes. A URL it left alone has
   to break mid-string or it pushes the dialog wider than the screen. */
.notes {
  overflow-wrap: anywhere;
}

.notes :deep(h4) {
  font-weight: 600;
  margin-top: 0.5rem;
}

.notes :deep(h4:first-child) {
  margin-top: 0;
}

.notes :deep(ul) {
  list-style: disc;
  padding-inline-start: 1.25em;
}

.notes :deep(p),
.notes :deep(ul) {
  margin-block: 0.35em;
}

.notes :deep(code) {
  background: rgb(var(--v-theme-surface-container-high));
  border-radius: 0.25rem;
  padding: 0.05em 0.3em;
}
</style>
