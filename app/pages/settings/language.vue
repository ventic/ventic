<script setup lang="ts">
// See app.vue for why this isn't `useI18n()`.
const { locale, locales, setLocale } = useNuxtApp().$i18n

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

const items = computed(() => {
  // The catalog is ordered by locale code, which is alphabetical in nothing
  // anyone reads — the labels are endonyms. Collate in the language the app is
  // currently in, so the alphabet doing the sorting is the reader's own.
  const collator = new Intl.Collator(locale.value)

  return locales.value.map(l => ({
    value: l.code,
    title: l.name ?? l.code,
    subtitle: english.of(l.code) === l.name ? undefined : english.of(l.code),
    // Derived, not stored: see app/utils/flag.ts. Esperanto has no country and
    // so no flag, which is why every use of it is guarded.
    flag: flag(l.language ?? l.code),
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
      <v-autocomplete
        v-model="current"
        autofocus
        auto-select-first
        :items="items"
        :filter-keys="['title', 'value', 'raw.subtitle']"
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
      </v-autocomplete>
      <p class="text-body-medium opacity-70">
        {{ $t('Descriptions, titles and artwork come from TMDB in {language} — the language list is TMDB\'s own, so anything offered here is a language it can answer in.', { language: translated }) }}
      </p>
      <p class="text-body-medium opacity-70">
        {{ $t('A language nobody has finished translating falls back to English one line at a time, so nothing is ever blank.') }}
      </p>
    </settings-section>
  </div>
</template>
