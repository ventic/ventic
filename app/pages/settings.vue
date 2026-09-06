<script setup lang="ts">
import { mdiArrowLeft } from '@mdi/js'

/**
 * The shell every section renders into: the sidebar's counterpart, holding the
 * way out and the heading. The sections themselves are child routes, so Back
 * walks them, a reload lands where the user was, and the drawer is a list of
 * links rather than a switch over a ref.
 */
definePageMeta({ layout: 'settings' })

const route = useRoute()
const routeName = useRouteBaseName()
const { mobile } = useDisplay()

// `settings-language`, `settings-appearance-background` — the section is the
// segment after `settings`, which is exactly a SECTIONS value.
const section = computed(() => routeName(route)?.split('-')[1])
const title = computed(() => SECTIONS.find(s => s.value === section.value)?.title() ?? $t('Settings'))
</script>

<template>
  <!-- A settings page changes height as switches appear and sections open, so
       an `auto` scrollbar comes and goes and the centred column under it steps
       sideways. `scroll` holds the track open instead — `scrollbar-gutter:
       stable` does the same in Chrome but is ignored by the WebKitGTK webview
       the Linux app actually runs in. -->
  <div class="h-full overflow-y-scroll">
    <div class="mx-auto max-w-3xl px-4 pb-16 md:px-8">
      <div class="flex items-center gap-2 pb-5 pt-3">
        <!-- Always-on way out. On a phone a section steps back to the list of
             sections first (settings/index.vue), which is what stands in for
             the sidebar there. -->
        <!-- `exact`: /settings is a prefix of every section's path, and without
             it the button is drawn pressed on all of them. -->
        <v-btn icon variant="text" color="on-surface" exact :to="localePath(mobile && section ? '/settings' : '/')">
          <v-icon :icon="mdiArrowLeft" />
          <v-tooltip activator="parent" :text="$t('Back')" />
        </v-btn>
        <h1 class="text-headline-medium font-bold">
          {{ title }}
        </h1>
      </div>

      <nuxt-page />
    </div>
  </div>
</template>
