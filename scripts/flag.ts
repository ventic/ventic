/**
 * The flag for a locale, as an icon name — at *build* time, and only there.
 *
 * It lives outside app/ so it can't be auto-imported into a component, because
 * calling it in the page is precisely the bug this had: the names it returns
 * come from the calling runtime's own CLDR copy, and the bundle can only hold
 * the ones the build machine's copy named. nuxt.config turns it into the
 * `flags` map the page reads.
 *
 * Nothing here is hand-kept: the locale's `language` tag already carries the
 * region CLDR picked for it (`sl-SI`, `pt-BR`), and Twemoji names its flags
 * after the English country name — so `Intl` answers the whole mapping, the
 * same way it answers the endonyms in scripts/i18n-locales.ts.
 *
 * A country flag emoji is two regional indicator letters, which Windows has no
 * glyphs for at all and a TV renders as "SI" — hence a picture rather than a
 * character. All 72 are inlined into the bundle by `clientBundle` in
 * nuxt.config, because a Tauri app can't reach the Iconify API offline.
 */
const COUNTRIES = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * Esperanto's, drawn here because no icon set has one to borrow: a flag emoji
 * is two regional indicator letters and Esperanto has no country to spell, so
 * `eo-EO` is a placeholder region ICU echoes straight back. The only set that
 * draws it at all is a second emoji family with square corners and an outline,
 * which would sit in the list looking like a mistake — this is Twemoji's own
 * geometry, a 36x26 rounded panel on a 36x36 canvas, so it lines up with the
 * other 71.
 *
 * nuxt.config registers it as a one-icon custom collection; `flag()` returns
 * the name below.
 */
export const ESPERANTO = {
  prefix: 'ventic',
  icons: {
    esperanto: {
      width: 36,
      height: 36,
      body: '<path fill="#009900" d="M32 5H4a4 4 0 0 0-4 4v18a4 4 0 0 0 4 4h28a4 4 0 0 0 4-4V9a4 4 0 0 0-4-4z"/>'
        + '<path fill="#EEE" d="M4 5h9v13H0V9a4 4 0 0 1 4-4z"/>'
        + '<path fill="#009900" d="M6.5 7.1L7.56 10.35L10.97 10.35L8.21 12.35L9.26 15.6L6.5 13.6L3.74 15.6L4.79 12.35L2.03 10.35L5.44 10.35Z"/>',
    },
  },
}

export function flag(language: string): string | undefined {
  if (language.split('-')[0] === 'eo')
    return `${ESPERANTO.prefix}:esperanto`

  const region = language.split('-')[1]
  if (!region)
    return undefined

  const country = COUNTRIES.of(region)
  // `of()` echoes the code back when it doesn't know it.
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
