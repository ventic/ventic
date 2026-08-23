/**
 * The flag for a locale, as a Twemoji icon name.
 *
 * Nothing here is hand-kept: the locale's `language` tag already carries the
 * region CLDR picked for it (`sl-SI`, `pt-BR`), and Twemoji names its flags
 * after the English country name — so `Intl` answers the whole mapping, the
 * same way it answers the endonyms in scripts/i18n-locales.ts.
 *
 * A country flag emoji is two regional indicator letters, which Windows has no
 * glyphs for at all and a TV renders as "SI" — hence a picture rather than a
 * character. The 71 that resolve are inlined into the bundle by `clientBundle`
 * in nuxt.config, because a Tauri app can't reach the Iconify API offline.
 */
const COUNTRIES = new Intl.DisplayNames(['en'], { type: 'region' })

export function flag(language: string): string | undefined {
  const region = language.split('-')[1]
  if (!region)
    return undefined

  const country = COUNTRIES.of(region)
  // `of()` echoes the code back when it doesn't know it — `eo-EO`, Esperanto,
  // which is nobody's country and has no flag here.
  if (!country || country === region)
    return undefined

  const name = country
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    // Twemoji hasn't followed ICU's rename; every other country matches.
    .replace(/^turkiye$/, 'turkey')

  return `twemoji:flag-for-flag-${name}`
}
