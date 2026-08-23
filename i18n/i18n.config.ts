/**
 * vue-i18n's own options. @nuxtjs/i18n picks this file up by name; everything
 * about *which* languages exist lives in i18n.locales.json instead.
 */
import { defaultLocale } from './i18n.locales.json'

const TODO = 'TODO_TRANSLATION: '

export default defineI18nConfig(() => ({
  legacy: false,
  /**
   * Vuetify ships translations for 43 of the 72 languages and this app for
   * however many have been through a translation pass — the rest of both resolve
   * here, one key at a time, rather than rendering blank.
   */
  fallbackLocale: defaultLocale,
  // Puts `$t` in every template, so a component needs no `useI18n()` line to
  // translate a string — see app/utils/i18n.ts for the script-side half.
  globalInjection: true,
  /**
   * The literal key first, a dotted path only if that misses.
   *
   * Keys here are English sentences, so they contain full stops — and
   * vue-i18n's own resolver walks every key as a path, reading "Nothing to play
   * yet." as the empty key inside "Nothing to play yet". Trying the flat key
   * first fixes that. The path walk is still needed underneath it, because the
   * one nested thing in a catalog is Vuetify's own `$vuetify` object, which is
   * imported from `vuetify/locale` rather than written out (see
   * scripts/i18n.ts) and so keeps Vuetify's shape.
   */
  messageResolver: (obj: Record<string, unknown>, key: string) => {
    if (obj?.[key] != null)
      return obj[key] as string
    return key.split('.').reduce<any>((node, part) => node?.[part], obj) ?? null
  },
  /**
   * A language nobody has translated yet still has to read as *something*, and
   * the marker `bun run i18n` writes is for the translation pass, not for the
   * screen. Stripping it leaves the English text — which is the key — so a
   * half-translated locale degrades to English string by string rather than
   * showing "TODO_TRANSLATION: Downloads" to whoever picked it.
   */
  postTranslation: (str: unknown) =>
    typeof str === 'string' && str.startsWith(TODO) ? str.slice(TODO.length) : str,
}))
