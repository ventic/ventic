<script setup lang="ts">
import { mdiAccountMultipleOutline, mdiAccountSwitchOutline, mdiArrowLeft, mdiCloudSyncOutline, mdiCogOutline, mdiDownload, mdiMenu, mdiUpdate } from '@mdi/js'

const ui = useUiStore()
const downloads = useDownloadsStore()
const updates = useUpdatesStore()
const profiles = useProfilesStore()
const route = useRoute()
const router = useRouter()
const { mobile } = useDisplay()
// Which page this is, by name rather than by path. `no_prefix` means a route
// name carries no language today, but comparing a name is what stays true if
// the prefix ever comes back — see localePath in app/utils/i18n.ts.
const routeName = useRouteBaseName()

const query = ref((route.query.q as string) ?? '')

function search(replace = true) {
  const q = query.value.trim()
  if (!q || route.query.q === q)
    return
  navigateTo({ path: localePath('/search'), query: { q } }, { replace: replace && route.path === localePath('/search') })
}

watchDebounced(query, () => search(), { debounce: 400 })

// Leaving search clears the field, so the box always matches what's on screen.
watch(() => route.path, () => {
  if (routeName(route) !== 'search')
    query.value = ''
})
</script>

<template>
  <header class="flex shrink-0 items-center gap-1 px-3 py-3 sm:gap-2 sm:px-5">
    <!-- "Give me more room": collapses the sidebar to icons. A phone has no
         sidebar to collapse — its navigation is the bar along the bottom. -->
    <v-btn v-if="!mobile" :icon="mdiMenu" variant="text" color="on-surface" @click="ui.rail = !ui.rail" />

    <v-btn
      v-if="routeName(route) !== 'index'"
      icon
      variant="text"
      color="on-surface"
      class="hidden sm:flex"
      @click="router.back()"
    >
      <v-icon :icon="mdiArrowLeft" />
    </v-btn>

    <!-- The search fills the row on a phone: `flex-1` grows it, `max-w-120` caps
         it on a wide window, and the right cluster's `ms-auto` (not a spacer)
         soaks up the slack — a spacer here would split the row and leave the box
         half-width with dead space beside it. -->
    <search-field
      v-model="query"
      :placeholder="mobile ? $t('Search') : $t('Search movies and shows')"
      :density="mobile ? 'default' : 'compact'"
      class="max-w-120 flex-1"
      @enter="search(false)"
    />

    <!-- ms-auto pins the cluster to the trailing edge past the filled search
         field. Downloads, settings and account are desktop-only here: on a
         phone all three live in the bar along the bottom, where the More tab's
         dot is what says a download is running. -->
    <div class="ms-auto flex items-center gap-1 sm:gap-2">
      <!-- Only here at all when there is something to say, and it goes away for
           good once the version behind it has been waved off — so it reads as a
           notification rather than as a permanent part of the toolbar. Shown at
           every width: a release is worth a detour. -->
      <v-badge
        v-if="updates.available && !updates.dismissed"
        dot
        color="primary"
        offset-x="10"
        offset-y="10"
      >
        <v-btn icon variant="text" color="on-surface" :to="localePath('/settings/about')">
          <v-icon :icon="mdiUpdate" />
          <v-tooltip activator="parent" :text="$t('Ventic {version} is out', { version: updates.available.version })" />
        </v-btn>
      </v-badge>

      <!-- Not on a child's profile, which has no Downloads page to go to. -->
      <v-badge
        v-if="!mobile && !profiles.current.kids"
        :model-value="!!downloads.active"
        :content="downloads.active"
        color="primary"
        offset-x="8"
        offset-y="8"
      >
        <v-btn icon variant="text" color="on-surface" :to="localePath('/downloads')">
          <v-icon :icon="mdiDownload" />
          <v-tooltip activator="parent" :text="downloads.active ? $t('{count} downloading', { count: downloads.active }) : $t('Downloads')" />
        </v-btn>
      </v-badge>
      <v-btn v-if="!mobile" icon variant="text" color="on-surface" :to="localePath('/settings/appearance')">
        <v-icon :icon="mdiCogOutline" />
        <v-tooltip activator="parent" :text="$t('Settings')" />
      </v-btn>

      <!-- Whose profile this is, and the way to someone else's. A phone has the
           same in the bar along the bottom (AppNav). -->
      <v-menu v-if="!mobile" location="bottom end" offset="6">
        <template #activator="{ props: menu }">
          <v-btn v-bind="menu" icon variant="text" color="on-surface" :aria-label="$t('Profile')">
            <profile-avatar :profile="profiles.current" :size="32" />
            <v-tooltip activator="parent" :text="profileName(profiles.current)" />
          </v-btn>
        </template>
        <v-card min-width="270" rounded="lg">
          <v-list nav density="comfortable">
            <v-list-item
              :title="profileName(profiles.current)"
              :subtitle="profiles.current.kids ? (Number.isFinite(profiles.left) ? $t('{time} left today', { time: runtimeText(Math.max(1, Math.ceil(profiles.left / 60))) }) : $t('Parental controls on')) : undefined"
            >
              <template #prepend>
                <profile-avatar :profile="profiles.current" :size="40" />
              </template>
            </v-list-item>
            <v-divider class="my-1" />
            <v-list-item :prepend-icon="mdiAccountSwitchOutline" :title="$t('Switch profile')" :to="localePath('/profiles')" rounded="lg" />
            <template v-if="!profiles.current.kids">
              <v-list-item :prepend-icon="mdiAccountMultipleOutline" :title="$t('Manage profiles')" :to="localePath('/settings/profiles')" rounded="lg" />
              <v-list-item :prepend-icon="mdiCloudSyncOutline" :title="$t('Sync and backup')" :to="localePath('/settings/account')" rounded="lg" />
            </template>
          </v-list>
        </v-card>
      </v-menu>
    </div>
  </header>
</template>
