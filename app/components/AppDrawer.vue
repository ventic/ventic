<script setup lang="ts">
import { mdiAnimationPlayOutline, mdiFilmstrip, mdiHomeOutline, mdiTelevisionClassic, mdiTelevisionPlay } from '@mdi/js'
import { LIBRARY_LISTS } from '~/stores/ui'

/**
 * The desktop's navigation: a permanent sidebar, collapsible to icons. Only
 * mounted from `md` up — a phone has the bar along the bottom instead (AppNav),
 * so there is no overlay here and nothing to open or close.
 */
const ui = useUiStore()

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

// "My stuff" — kept apart from the feeds above.
const library = computed(() => LIBRARY_LISTS.map(l => ({ title: l.title(), icon: l.icon, to: localePath(`/${l.value}`) })))
</script>

<template>
  <v-navigation-drawer
    :rail="ui.rail"
    :width="236"
    permanent
    class="panel border-none"
  >
    <nuxt-link :to="localePath('/')" class="flex items-center gap-3 px-4 py-5">
      <img src="/logo.svg" alt="Ventic" class="size-26px shrink-0">
      <span v-if="!ui.rail" class="text-title-large whitespace-nowrap font-bold">Ventic</span>
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
        <v-tooltip v-if="ui.rail" activator="parent" location="end" :text="link.title" />
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
        <v-tooltip v-if="ui.rail" activator="parent" location="end" :text="link.title" />
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>
