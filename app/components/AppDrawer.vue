<script setup lang="ts">
import type { SectionKey } from '~/stores/settings'
import { mdiAccountCircleOutline, mdiAnimationPlayOutline, mdiBookmarkOutline, mdiCogOutline, mdiFilmstrip, mdiHeartOutline, mdiHistory, mdiHomeOutline, mdiTelevisionClassic, mdiTrayArrowDown } from '@mdi/js'

const ui = useUiStore()
const settings = useSettingsStore()
const downloads = useDownloadsStore()
const route = useRoute()
const { mobile } = useDisplay()

// Permanent on desktop, an overlay on mobile — one drawer, two behaviours.
const open = computed({
  get: () => !mobile.value || ui.drawer,
  set: value => (ui.drawer = value),
})

const rail = computed(() => !mobile.value && ui.rail)

// Tapping a link on mobile should get the overlay out of the way.
watch(() => route.fullPath, () => {
  if (mobile.value)
    ui.drawer = false
})

// The browse feeds.
const links = [
  { title: 'Home', icon: mdiHomeOutline, to: '/' },
  { title: 'Movies', icon: mdiFilmstrip, to: '/movies' },
  { title: 'TV Shows', icon: mdiTelevisionClassic, to: '/tv' },
  { title: 'Anime', icon: mdiAnimationPlayOutline, to: '/anime' },
]

// "My stuff" — kept apart from the feeds above and the app controls below.
const library = [
  { title: 'Favourites', icon: mdiHeartOutline, to: '/favourites' },
  { title: 'Watchlist', icon: mdiBookmarkOutline, to: '/watchlist' },
  { title: 'History', icon: mdiHistory, to: '/history' },
]

// Both settings items land on /settings and only pick which section opens.
// On a phone the toolbar keeps only the downloads badge, so this drawer is the
// only place Settings and Account can be reached.
function openSettings(section: SectionKey) {
  settings.section = section
}
</script>

<template>
  <v-navigation-drawer
    v-model="open"
    :rail="rail"
    :width="236"
    :permanent="!mobile"
    :temporary="mobile"
    class="panel border-none"
  >
    <nuxt-link to="/" class="flex items-center gap-3 px-4 py-5">
      <img src="/logo.svg" alt="Ventic" class="size-26px shrink-0">
      <span v-if="!rail" class="text-title-large whitespace-nowrap font-bold">Ventic</span>
    </nuxt-link>

    <v-list nav density="comfortable" class="px-2">
      <v-list-item
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        :prepend-icon="link.icon"
        :title="link.title"
        color="primary"
        rounded="lg"
      />

      <v-divider class="mx-2 my-3 opacity-40" />

      <v-list-item
        v-for="link in library"
        :key="link.to"
        :to="link.to"
        :prepend-icon="link.icon"
        :title="link.title"
        color="primary"
        rounded="lg"
      />
    </v-list>

    <!-- Phone only: on a wide window the toolbar carries these three, so a copy
         here would just be the duplicate that read as clutter. On a phone the
         toolbar keeps only the downloads badge and this drawer is an overlay the
         toolbar can't reach, so settings and account live here instead. -->
    <template #append>
      <v-list v-if="mobile" nav density="comfortable" class="px-2 pb-2">
        <v-list-item
          :prepend-icon="mdiTrayArrowDown"
          title="Downloads"
          to="/downloads"
          color="primary"
          rounded="lg"
        >
          <template v-if="downloads.active" #append>
            <v-chip size="x-small" color="primary" :text="String(downloads.active)" />
          </template>
        </v-list-item>
        <v-list-item
          :prepend-icon="mdiCogOutline"
          title="Settings"
          to="/settings"
          color="primary"
          rounded="lg"
          @click="openSettings('appearance')"
        />
        <v-list-item
          :prepend-icon="mdiAccountCircleOutline"
          title="Account"
          to="/settings"
          color="primary"
          rounded="lg"
          @click="openSettings('account')"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>
