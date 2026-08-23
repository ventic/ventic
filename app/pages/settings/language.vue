<script setup lang="ts">
const { locale, locales, setLocale } = useI18n()

/**
 * Switching a language is a *navigation* — every route carries its prefix
 * (`/sl/downloads`), so `setLocale` replaces the current route with the same
 * page in the new language rather than swapping a string. Nothing is lost:
 * the user stays exactly where they were.
 *
 * app.vue is what writes the choice to `settings.locale`, off the locale
 * itself, so arriving here by any other route — a deep link, a restored
 * session — is remembered the same way.
 */
const current = computed({
  get: () => locale.value,
  set: (code: string) => setLocale(code as typeof locale.value),
})

/**
 * Native name first, English name after it — someone who has the app in a
 * language they can't read has to find their own in the list, and "Deutsch"
 * is the only label that helps them do it. The English half is what makes it
 * searchable for everyone else.
 */
const english = new Intl.DisplayNames(['en'], { type: 'language' })

const items = computed(() => locales.value.map(l => ({
  value: l.code,
  title: l.name ?? l.code,
  subtitle: english.of(l.code) === l.name ? undefined : english.of(l.code),
})))

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
        clearable
        clear-on-select
        auto-select-first
        :items="items"
        variant="solo-filled"
        item-props
        :label="$t('Language')"
        hide-details
      />
      <p class="text-body-medium opacity-70">
        {{ $t('Descriptions, titles and artwork come from TMDB in {language} — the language list is TMDB\'s own, so anything offered here is a language it can answer in.', { language: translated }) }}
      </p>
      <p class="text-body-medium opacity-70">
        {{ $t('A language nobody has finished translating falls back to English one line at a time, so nothing is ever blank.') }}
      </p>
    </settings-section>
  </div>
</template>
