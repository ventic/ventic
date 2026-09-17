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
const { locale } = useNuxtApp().$i18n

// `settings-language`, `settings-appearance-background` — the section is the
// segment after `settings`, which is exactly a SECTIONS value.
const section = computed(() => routeName(route)?.split('-')[1])

// --- Search ------------------------------------------------------------------
// The box is the sidebar's (a phone's is below, on the list of sections); the
// results are this page's, in place of the section until the box is emptied.
const searched = computed(() => typeof route.query.q === 'string' ? route.query.q.trim() : '')

const sources = shallowRef<Record<string, string>>()
watch(searched, async q => {
  if (q && !sources.value)
    sources.value = await settingsSources()
}, { immediate: true })

// Rebuilt when the language changes, which is when every word in it does.
const docs = computed(() => sources.value && settingsDocs(
  settingsEntries(sources.value).filter(entry =>
    SECTIONS.some(s => s.value === entry.page) && PLATFORM_SECTIONS[entry.when ?? '']?.() !== false),
  key => $t(key),
  locale.value,
))

const hits = computed(() => docs.value && searched.value
  ? searchSettings(docs.value, searched.value, locale.value).map(({ doc, label }) => ({
      key: `${doc.path}#${doc.heading}`,
      to: { path: localePath(doc.path), query: { find: doc.find, label } },
      title: label ?? doc.heading,
      subtitle: [...doc.crumb, ...(label ? [doc.heading] : [])].filter(part => part !== (label ?? doc.heading)).join(' › '),
      icon: SECTIONS.find(s => s.value === doc.page)?.icon,
    }))
  : [])

const title = computed(() => searched.value
  ? $t('Search')
  : SECTIONS.find(s => s.value === section.value)?.title() ?? $t('Settings'))

/**
 * Arriving from a result: bring what matched into view and say which section it
 * was. The page may still be loading, or draw that section a moment late (VPN
 * waits on the engine), so it is looked for a few times — and one this device
 * never drew leaves you at the top of the page, which is the right place anyway.
 */
watch(() => [route.query.find, route.query.label], async ([find, label]) => {
  const titles = [find ?? []].flat()
  if (!titles.length)
    return
  for (let tries = 0; tries < 30; tries++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const heading = [...document.querySelectorAll('section h2')].find(h => titles.includes(h.textContent?.trim() ?? ''))
    const found = heading?.closest('section')
    if (!found)
      continue

    // The control itself where a label matched: the deepest element reading
    // exactly that, then the nearest thing around it that takes focus.
    const text = typeof label === 'string'
      ? [...found.querySelectorAll('*')].reverse().find(el => el.textContent?.trim() === label)
      : undefined
    ;(text ?? found).scrollIntoView({ block: text ? 'center' : 'start', behavior: 'smooth' })
    found.classList.add('found')
    setTimeout(() => found.classList.remove('found'), 2000)

    // Focus follows only for a remote or a keyboard, as a navigation's does
    // (plugins/dpad.client.ts) — a mouse would get a caret it never asked for.
    if (document.documentElement.classList.contains('dpad')) {
      for (let el = text ?? found; el && el !== found.parentElement; el = el.parentElement!) {
        const targets = [el.closest<HTMLElement>('a[href], button'), ...el.querySelectorAll<HTMLElement>('a[href], button, input, textarea, [tabindex="0"]')]
        // One that won't take it (an input `TvField` has parked) is passed over.
        const taken = targets.some(target => {
          target?.focus()
          return !!target && document.activeElement === target
        })
        if (taken)
          break
      }
    }
    return
  }
}, { immediate: true })
</script>

<!-- A settings page changes height as switches appear and sections open, so
     an `auto` scrollbar comes and goes and the centred column under it steps
     sideways. `scroll` holds the track open instead — `scrollbar-gutter:
     stable` does the same in Chrome but is ignored by the WebKitGTK webview
     the Linux app actually runs in. -->
<template>
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
        </v-btn>
        <h1 class="text-headline-medium font-bold">
          {{ title }}
        </h1>
      </div>

      <!-- A phone has no sidebar to hold the box, so it heads the list of
           sections, the way a phone's own settings search does. -->
      <settings-search v-if="mobile && !section" density="default" class="mb-4" />

      <template v-if="searched">
        <v-list nav data-settings-results class="bg-transparent px-0">
          <v-list-item
            v-for="hit in hits"
            :key="hit.key"
            :to="hit.to"
            :prepend-icon="hit.icon"
            :title="hit.title"
            :subtitle="hit.subtitle"
            rounded="lg"
            class="mb-1 bg-surface-container/40"
          />
        </v-list>
        <p v-if="docs && !hits.length" class="text-body-medium opacity-70">
          {{ $t('Nothing matches.') }}
        </p>
      </template>

      <!-- Hidden rather than unmounted, so a half-typed field is still there
           after a look at the results. -->
      <div v-show="!searched">
        <nuxt-page />
      </div>
    </div>
  </div>
</template>
