<script setup lang="ts">
import type { SectionKey } from '~/stores/settings'
import { mdiAccountCircle, mdiArrowLeft, mdiCogOutline, mdiDownload, mdiMenu, mdiUpdate } from '@mdi/js'

const ui = useUiStore()
const settings = useSettingsStore()
const downloads = useDownloadsStore()
const updates = useUpdatesStore()
const route = useRoute()
const router = useRouter()
const { mobile } = useDisplay()

const query = ref((route.query.q as string) ?? '')

function search(replace = true) {
  const q = query.value.trim()
  if (!q || route.query.q === q)
    return
  navigateTo({ path: '/search', query: { q } }, { replace: replace && route.path === '/search' })
}

watchDebounced(query, () => search(), { debounce: 400 })

// Leaving search clears the field, so the box always matches what's on screen.
watch(() => route.path, path => {
  if (path !== '/search')
    query.value = ''
})

// The hamburger means "give me more room" on desktop and "show me the nav" on
// mobile, where the sidebar is an overlay.
function toggleNav() {
  if (mobile.value)
    ui.drawer = !ui.drawer
  else
    ui.rail = !ui.rail
}

/** Both buttons land on /settings; which one was pressed picks the section. */
function open(section: SectionKey) {
  settings.section = section
}
</script>

<template>
  <header class="flex shrink-0 items-center gap-1 px-3 py-3 sm:gap-2 sm:px-5">
    <v-btn :icon="mdiMenu" variant="text" color="on-surface" @click="toggleNav" />

    <v-btn
      v-if="route.path !== '/'"
      icon
      variant="text"
      color="on-surface"
      class="hidden sm:flex"
      @click="router.back()"
    >
      <v-icon :icon="mdiArrowLeft" />
      <v-tooltip activator="parent" text="Back" />
    </v-btn>

    <!-- The search fills the row on a phone: `flex-1` grows it, `max-w-120` caps
         it on a wide window, and the right cluster's `ms-auto` (not a spacer)
         soaks up the slack — a spacer here would split the row and leave the box
         half-width with dead space beside it. -->
    <search-field
      v-model="query"
      :placeholder="mobile ? 'Search' : 'Search movies and shows'"
      :density="mobile ? 'default' : 'compact'"
      class="max-w-120 flex-1"
      @enter="search(false)"
    />

    <!-- ms-auto pins the cluster to the trailing edge past the filled search
         field. Downloads shows at every width — a phone can then glance at a
         background download without opening the drawer — while settings and
         account are desktop-only here: on a phone they move into the drawer,
         the overlay this toolbar can't reach. -->
    <div class="ms-auto flex items-center gap-1 sm:gap-2">
      <!-- Only here at all when there is something to say, and it goes away for
           good once the version behind it has been waved off — so it reads as a
           notification rather than as a permanent part of the toolbar. Shown at
           every width, unlike settings and account: a phone's drawer is an
           overlay this row can't reach, and a release is worth a detour. -->
      <v-badge
        v-if="updates.available && !updates.dismissed"
        dot
        color="primary"
        offset-x="10"
        offset-y="10"
      >
        <v-btn icon variant="text" color="on-surface" to="/settings" @click="open('about')">
          <v-icon :icon="mdiUpdate" />
          <v-tooltip activator="parent" :text="`Ventic ${updates.available.version} is out`" />
        </v-btn>
      </v-badge>

      <v-badge
        :model-value="!!downloads.active"
        :content="downloads.active"
        color="primary"
        offset-x="8"
        offset-y="8"
      >
        <v-btn icon variant="text" color="on-surface" to="/downloads">
          <v-icon :icon="mdiDownload" />
          <v-tooltip activator="parent" :text="downloads.active ? `${downloads.active} downloading` : 'Downloads'" />
        </v-btn>
      </v-badge>
      <v-btn icon variant="text" color="on-surface" class="hidden sm:flex" to="/settings" @click="open('appearance')">
        <v-icon :icon="mdiCogOutline" />
        <v-tooltip activator="parent" text="Settings" />
      </v-btn>
      <v-btn icon variant="text" color="on-surface" class="hidden sm:flex" to="/settings" @click="open('account')">
        <v-icon :icon="mdiAccountCircle" />
        <v-tooltip activator="parent" text="Account" />
      </v-btn>
    </div>
  </header>
</template>
