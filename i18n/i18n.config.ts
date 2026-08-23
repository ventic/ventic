/**
 * vue-i18n's own options. @nuxtjs/i18n picks this file up by name; everything
 * about *which* languages exist lives in i18n.locales.json instead.
 *
 * Deliberately not wrapped in `defineI18nConfig`: that macro is the identity
 * function, and the module's build step strips the call anyway — but its
 * generic constraint instantiates `LocaleMessages` over every configured code,
 * and `UnionToTuple` on 72 of them blows TypeScript's instantiation depth. A
 * plain loader function is what `loadVueI18nOptions` wanted either way.
 */
import type { Locale, VueMessageType } from 'vue-i18n'
import { defaultLocale } from './i18n.locales.json'

const TODO = 'TODO_TRANSLATION: '

export default () => ({
  legacy: false,
  /**
   * Vuetify ships translations for 39 of the 72 languages and this app for
   * however many have been through a translation pass — the rest of both resolve
   * here, one key at a time, rather than rendering blank.
   *
   * Cast because the code list arrives as JSON, and @nuxtjs/i18n has narrowed
   * `Locale` to the 72 codes it generated from that same file.
   */
  fallbackLocale: defaultLocale as Locale,
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
  messageResolver: (obj: unknown, key: string) => {
    const table = obj as Record<string, any> | null
    if (table?.[key] != null)
      return table[key]
    return key.split('.').reduce<any>((node, part) => node?.[part], table) ?? null
  },
  /**
   * A language nobody has translated yet still has to read as *something*, and
   * the marker `bun run i18n` writes is for the translation pass, not for the
   * screen. Stripping it leaves the English text — which is the key — so a
   * half-translated locale degrades to English string by string rather than
   * showing "TODO_TRANSLATION: Downloads" to whoever picked it.
   */
  postTranslation: (str: VueMessageType) =>
    typeof str === 'string' && str.startsWith(TODO) ? str.slice(TODO.length) : str,
})
