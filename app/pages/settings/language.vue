<script setup lang="ts">
import type { Component } from 'vue'
// The narrow paths, not the `vuetify/components` barrel: that one pulls every
// component in the library into the graph, which in dev is a rebuild long enough
// for the boot screen to give up on itself.
import { VAutocomplete } from 'vuetify/components/VAutocomplete'
import { VSelect } from 'vuetify/components/VSelect'

// See app.vue for why this isn't `useI18n()`.
const { locale, locales, setLocale } = useNuxtApp().$i18n

/**
 * Type to narrow the list, or open it and walk it?
 *
 * A television gets the second. Its field is readonly, so OK opens the menu and
 * the d-pad walks it — where an autocomplete's field can be typed into, and
 * Android puts the on-screen keyboard over the whole screen the moment one has
 * focus. With `autofocus` on top of that, arriving at this page raised the
 * keyboard before anything had been asked for, and OK went to the keyboard
 * rather than to the list nobody could see behind it.
 *
 * The list is the same either way and it is sorted in the reader's own alphabet,
 * so walking it is no worse than a phone's language picker — and it is the only
 * one of the two a remote can actually drive.
 */
const tv = isTv() === true
// Cast one at a time: the *union* of two Vuetify component types is deep enough
// that vue-tsc gives up on it, and `<component :is>` type-checks nothing anyway.
const picker: Component = tv ? (VSelect as Component) : (VAutocomplete as Component)
/**
 * Whichever half is not shared: one filters as you type, the other just has to
 * be big enough to be read and walked from a sofa.
 */
const pickerProps = tv
  ? { menuProps: { maxHeight: 480 } }
  : { autofocus: true, autoSelectFirst: true, filterKeys: ['title', 'value', 'raw.subtitle'] }

/**
 * `setLocale` swaps the catalog in place and nothing navigates — the URL
 * carries no language (`strategy: 'no_prefix'` in nuxt.config), so the page
 * stays where it is and the history stack is untouched. Back means back.
 *
 * app.vue is what writes the choice to `settings.locale`, off the locale
 * itself, so a language restored at boot is remembered the same way.
 *
 * Guarded because the field can hand back `null` — clearing its text is not a
 * request to have the app in no language at all.
 */
const current = computed({
  get: () => locale.value,
  set: (code: string | null) => {
    if (code)
      setLocale(code as typeof locale.value)
  },
})

/**
 * Native name first, English name after it — someone who has the app in a
 * language they can't read has to find their own in the list, and "Deutsch"
 * is the only label that helps them do it. The English half is what makes it
 * searchable for everyone else — but only once `filter-keys` names it: the
 * default filter walks the *internal* item, where the whole original object is
 * one `raw` key it stringifies to "[object Object]", so "german" matched
 * nothing.
 */
const english = new Intl.DisplayNames(['en'], { type: 'language' })

// Looked up, never derived: which flag a locale gets is worked out once at
// build time, because the bundle inlines those exact icon names and nothing
// else — see `flags` in nuxt.config.
const { flags } = useRuntimeConfig().public

const items = computed(() => {
  // The catalog is ordered by locale code, which is alphabetical in nothing
  // anyone reads — the labels are endonyms. Collate in the language the app is
  // currently in, so the alphabet doing the sorting is the reader's own.
  const collator = new Intl.Collator(locale.value)

  return locales.value.map(l => ({
    value: l.code,
    title: l.name ?? l.code,
    subtitle: english.of(l.code) === l.name ? undefined : english.of(l.code),
    // Guarded because a language TMDB adds is in the picker before the next
    // build has drawn it a flag.
    flag: flags[l.code],
  })).sort((a, b) => collator.compare(a.title, b.title))
})

const translated = computed(() =>
  locales.value.find(l => l.code === locale.value)?.language ?? 'en-US')
</script>

<template>
  <div class="flex flex-col gap-6">
    <settings-section
      :title="$t('Language')"
      :hint="$t('What language the app is in, and what language film and show descriptions are fetched in.')"
    >
      <component
        :is="picker"
        v-bind="pickerProps"
        v-model="current"
        :items="items"
        variant="solo-filled"
        :label="$t('Language')"
        hide-details
      >
        <template #item="{ item, props: itemProps }">
          <v-list-item v-bind="itemProps" :subtitle="item.subtitle">
            <template #prepend>
              <icon v-if="item.flag" :name="item.flag" size="24" class="me-3" />
              <span v-else class="me-3 inline-block w-24px" />
            </template>
          </v-list-item>
        </template>

        <template #selection="{ item }">
          <icon v-if="item.flag" :name="item.flag" size="20" class="me-2" />
          {{ item.title }}
        </template>
      </component>
      <p class="text-body-medium opacity-70">
        {{ $t('Descriptions, titles and artwork come from TMDB in {language} — the language list is TMDB\'s own, so anything offered here is a language it can answer in.', { language: translated }) }}
      </p>
      <p class="text-body-medium opacity-70">
        {{ $t('A language nobody has finished translating falls back to English one line at a time, so nothing is ever blank.') }}
      </p>
    </settings-section>
  </div>
</template>
