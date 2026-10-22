<script setup lang="ts">
import { mdiAnimationPlayOutline, mdiCalendarMonthOutline, mdiFilmstrip, mdiHomeOutline, mdiTelevisionClassic, mdiTelevisionPlay } from '@mdi/js'
import { LIBRARY_LISTS } from '~/stores/ui'

/**
 * The desktop's navigation: a permanent sidebar, collapsible to icons. Only
 * mounted from `md` up — a phone has the bar along the bottom instead (AppNav),
 * so there is no overlay here and nothing to open or close.
 */
const ui = useUiStore()
const profiles = useProfilesStore()

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
  // a playlist for. Not on a child's profile, though: nothing on it is rated.
  ...profiles.current.kids ? [] : [{ title: $t('Live TV'), icon: mdiTelevisionPlay, to: localePath('/live') }],
])

// "My stuff" — kept apart from the feeds above. The calendar is the same lists
// looked at by date, so it sits with them.
const library = computed(() => [
  ...LIBRARY_LISTS.map(l => ({ title: l.title(), icon: l.icon, to: localePath(`/${l.value}`) })),
  { title: $t('Calendar'), icon: mdiCalendarMonthOutline, to: localePath('/calendar') },
])
</script>

<template>
  <!-- 80px collapsed: MD3's navigation rail, which names every stop under its
       icon. A bare column of icons leaned on tooltips to say which page was
       which, and a television hides every tooltip (layers.css) — so on the set
       the collapsed sidebar was eight unlabelled pictures. -->
  <v-navigation-drawer
    :rail="ui.rail"
    :rail-width="80"
    :width="236"
    permanent
    class="panel border-none"
  >
    <nuxt-link :to="localePath('/')" class="flex items-center gap-3 py-5" :class="ui.rail ? 'justify-center' : 'px-4'">
      <img src="/logo.svg" alt="Ventic" class="size-26px shrink-0">
      <span v-if="!ui.rail" class="text-title-large whitespace-nowrap font-bold">Ventic</span>
    </nuxt-link>

    <!-- The rail. Plain links rather than list items: a list item's title is
         one line beside its icon, and this is a label under one. The pill is
         MD3's active indicator, and hover and focus both light it, because a
         remote never hovers. -->
    <nav v-if="ui.rail" class="flex flex-col items-center gap-1 px-1.5">
      <template v-for="(group, i) in [links, library]" :key="i">
        <v-divider v-if="i" class="my-2 w-8 flex-none opacity-40" />
        <nuxt-link v-for="link in group" :key="link.to" v-slot="{ href, navigate, isActive }" :to="link.to" custom>
          <a
            :href="href ?? undefined"
            class="group w-full flex flex-col items-center gap-1 rounded-xl py-1.5"
            :aria-current="isActive ? 'page' : undefined"
            @click="navigate"
          >
            <span
              class="h-8 w-14 flex items-center justify-center rounded-full transition-colors duration-200"
              :class="isActive ? 'bg-primary/18 text-primary' : 'group-hover:bg-on-surface/8 group-focus-visible:bg-on-surface/8'"
            >
              <v-icon :icon="link.icon" size="22" />
            </span>
            <span
              class="max-w-full truncate px-0.5 text-label-medium"
              :class="isActive ? 'font-bold' : 'opacity-75 group-hover:opacity-100'"
            >{{ link.title }}</span>
          </a>
        </nuxt-link>
      </template>
    </nav>

    <v-list v-else nav density="comfortable" class="px-2">
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
  </v-navigation-drawer>
</template>
