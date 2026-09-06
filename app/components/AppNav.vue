<script setup lang="ts">
import { mdiAccountCircleOutline, mdiAnimationPlayOutline, mdiCogOutline, mdiDotsHorizontal, mdiFilmstrip, mdiHeartOutline, mdiHomeOutline, mdiTelevisionClassic, mdiTelevisionPlay, mdiTrayArrowDown } from '@mdi/js'
import { LIBRARY_LISTS } from '~/stores/ui'

/**
 * The phone's navigation: five stops along the bottom, where the thumb already
 * is. The desktop keeps its sidebar; below `md` that sidebar was an overlay
 * behind a hamburger — two taps to anywhere, and a menu nobody could see.
 *
 * Four stops are pages. The fifth is a sheet holding everything the sidebar
 * listed that a bar has no room for, because a bar past five stops is a row of
 * labels nobody can read. Downloads is in there, so the dot on the More tab is
 * what says a download is running.
 */
const downloads = useDownloadsStore()
const route = useRoute()
const routeName = useRouteBaseName()

const tabs = computed(() => [
  { title: $t('Home'), icon: mdiHomeOutline, to: localePath('/'), match: ['index'] },
  { title: $t('Movies'), icon: mdiFilmstrip, to: localePath('/movies'), match: ['movies'] },
  { title: $t('TV Shows'), icon: mdiTelevisionClassic, to: localePath('/tv'), match: ['tv'] },
  // One stop for the three lists; the pages switch between themselves.
  { title: $t('Library'), icon: mdiHeartOutline, to: localePath('/favourites'), match: LIBRARY_LISTS.map(l => l.value) },
])

const more = computed(() => [
  { title: $t('Anime'), icon: mdiAnimationPlayOutline, to: localePath('/anime') },
  { title: $t('Live TV'), icon: mdiTelevisionPlay, to: localePath('/live') },
  { title: $t('Downloads'), icon: mdiTrayArrowDown, to: localePath('/downloads'), badge: downloads.active },
  { title: $t('Settings'), icon: mdiCogOutline, to: localePath('/settings') },
  { title: $t('Account'), icon: mdiAccountCircleOutline, to: localePath('/settings/account') },
])

const sheet = ref(false)
const name = computed(() => routeName(route) ?? '')
// The two feeds that live in the sheet light the tab up, so the bar always
// says where you are.
const inMore = computed(() => ['anime', 'live'].includes(name.value))

watch(() => route.fullPath, () => (sheet.value = false))

const TAB = 'flex flex-1 flex-col items-center gap-1 border-0 bg-transparent px-1 pb-2.5 pt-2.5 text-label-medium outline-none transition-colors'
const PILL = 'grid h-8 w-16 place-items-center rounded-full transition-colors'
</script>

<template>
  <nav class="panel flex shrink-0 pb-[var(--safe-bottom)]">
    <nuxt-link
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      :class="[TAB, tab.match.includes(name) ? 'text-primary' : 'text-on-surface opacity-75']"
      :aria-current="tab.match.includes(name) ? 'page' : undefined"
    >
      <span :class="[PILL, tab.match.includes(name) && 'bg-primary/15']">
        <v-icon :icon="tab.icon" size="24" />
      </span>
      {{ tab.title }}
    </nuxt-link>

    <button type="button" :class="[TAB, inMore ? 'text-primary' : 'text-on-surface opacity-75']" @click="sheet = true">
      <span class="relative" :class="[PILL, inMore && 'bg-primary/15']">
        <v-icon :icon="mdiDotsHorizontal" size="24" />
        <span v-if="downloads.active" class="absolute right-4 top-1 size-2 rounded-full bg-primary" />
      </span>
      {{ $t('More') }}
    </button>
  </nav>

  <v-bottom-sheet v-model="sheet">
    <v-card rounded="t-xl" class="pb-[var(--safe-bottom)]">
      <v-list nav class="px-2 py-2">
        <v-list-item
          v-for="item in more"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          color="primary"
          rounded="lg"
        >
          <template v-if="item.badge" #append>
            <v-chip size="x-small" color="primary" :text="String(item.badge)" />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </v-bottom-sheet>
</template>
