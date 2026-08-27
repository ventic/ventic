<script setup lang="ts">
import { mdiAccountCircleOutline, mdiAnimationPlayOutline, mdiBookmarkOutline, mdiCogOutline, mdiFilmstrip, mdiHeartOutline, mdiHistory, mdiHomeOutline, mdiTelevisionClassic, mdiTelevisionPlay, mdiTrayArrowDown } from '@mdi/js'

const ui = useUiStore()
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

// The browse feeds. Computed rather than a plain array because the labels are
// translated, so the list has to be rebuilt when the language changes — and
// because `localePath` is what the paths would move through if the language
// ever went back into the URL.
const links = computed(() => [
  { title: $t('Home'), icon: mdiHomeOutline, to: localePath('/') },
  { title: $t('Movies'), icon: mdiFilmstrip, to: localePath('/movies') },
  { title: $t('TV Shows'), icon: mdiTelevisionClassic, to: localePath('/tv') },
  { title: $t('Anime'), icon: mdiAnimationPlayOutline, to: localePath('/anime') },
  // Listed even with no playlist configured: the page's own empty state is what
  // says how to fill it, and a feature nobody can see is a feature nobody adds
  // a playlist for.
  { title: $t('Live TV'), icon: mdiTelevisionPlay, to: localePath('/live') },
])

// "My stuff" — kept apart from the feeds above and the app controls below.
const library = computed(() => [
  { title: $t('Favourites'), icon: mdiHeartOutline, to: localePath('/favourites') },
  { title: $t('Watchlist'), icon: mdiBookmarkOutline, to: localePath('/watchlist') },
  { title: $t('History'), icon: mdiHistory, to: localePath('/history') },
])

// On a phone the toolbar keeps only the downloads badge, so this drawer is the
// only place Settings and Account can be reached.
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
    <nuxt-link :to="localePath('/')" class="flex items-center gap-3 px-4 py-5">
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
      >
        <!-- Collapsed to icons, the label is the only thing naming the page.
             `end` rather than `right` so it stays outside the drawer in the
             four right-to-left languages too. -->
        <v-tooltip v-if="rail" activator="parent" location="end" :text="link.title" />
      </v-list-item>

      <v-divider class="mx-2 my-3 opacity-40" />

      <v-list-item
        v-for="link in library"
        :key="link.to"
        :to="link.to"
        :prepend-icon="link.icon"
        :title="link.title"
        color="primary"
        rounded="lg"
      >
        <!-- Collapsed to icons, the label is the only thing naming the page.
             `end` rather than `right` so it stays outside the drawer in the
             four right-to-left languages too. -->
        <v-tooltip v-if="rail" activator="parent" location="end" :text="link.title" />
      </v-list-item>
    </v-list>

    <!-- Phone only: on a wide window the toolbar carries these three, so a copy
         here would just be the duplicate that read as clutter. On a phone the
         toolbar keeps only the downloads badge and this drawer is an overlay the
         toolbar can't reach, so settings and account live here instead. -->
    <template #append>
      <v-list v-if="mobile" nav density="comfortable" class="px-2 pb-2">
        <v-list-item
          :prepend-icon="mdiTrayArrowDown"
          :title="$t('Downloads')"
          :to="localePath('/downloads')"
          color="primary"
          rounded="lg"
        >
          <template v-if="downloads.active" #append>
            <v-chip size="x-small" color="primary" :text="String(downloads.active)" />
          </template>
        </v-list-item>
        <v-list-item
          :prepend-icon="mdiCogOutline"
          :title="$t('Settings')"
          :to="localePath('/settings/appearance')"
          color="primary"
          rounded="lg"
        />
        <v-list-item
          :prepend-icon="mdiAccountCircleOutline"
          :title="$t('Account')"
          :to="localePath('/settings/account')"
          color="primary"
          rounded="lg"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>
