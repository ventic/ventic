import type { TranslateOptions } from 'vue-i18n'

/**
 * Every translated string in the app goes through this, and only through this.
 * `bun run i18n` scans for it and fills every locale file; nothing else here
 * names a translation key.
 *
 * Auto-imported, so a `.ts` file needs no import — and vue-i18n injects the
 * same `$t` into every template, so a `.vue` file needs neither an import nor a
 * `useI18n()` line. Writing the call *is* the whole job:
 *
 * @example
 * $t('Downloads')
 * $t('{count} files', { count: files.length })
 *
 * There is one catalog per language rather than per-component blocks, so a
 * string used in two places is the same key with the same translation.
 *
 * Constraint: must run inside a Nuxt context — component setup/render, or a
 * util called from one, same as any `use*` helper.
 */
export function $t(
  key: string,
  values?: number | string | unknown[] | Record<string, unknown>,
  options?: TranslateOptions,
): string {
  return useNuxtApp().$i18n.t(key, values as any, options as any)
}

/**
 * A path, localised for the current routing strategy. Under `no_prefix` — what
 * this app uses — that is the path back unchanged, so these calls are a no-op
 * today; they are what makes putting the language back into the URL a config
 * change rather than a sweep of every `:to` in the app.
 *
 * Auto-imported, so scripts and templates alike just call it — the module's own
 * `$localePath` is typed for route *names*, and this is the one place that hands
 * it the `{ path }` form it wants.
 */
export function localePath(path: string) {
  return useNuxtApp().$localePath({ path })
}

/**
 * The BCP47 tag for `Intl` — dates, money, number grouping. Read off
 * `<html lang>` rather than from `useI18n`, so the pure formatting helpers in
 * `utils/tmdb.ts` keep working under `bun run check:*`, where there is no Nuxt
 * and no locale to ask (see scripts/i18n-stub.ts).
 */
export function uiLocale() {
  return globalThis.document?.documentElement.lang || 'en-US'
}

/**
 * The language TMDB should answer in, as the regional tag it wants — `pt` is a
 * URL prefix, `pt-BR` is what has the overviews. Kept beside `$t` because both
 * read the same locale; see scripts/i18n-locales.ts for where the tag comes
 * from.
 */
export function tmdbLanguage() {
  const i18n = useNuxtApp().$i18n
  return i18n.locales.value.find(l => l.code === i18n.locale.value)?.language ?? 'en-US'
}
