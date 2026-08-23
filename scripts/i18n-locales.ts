// Regenerate the locale list from TMDB: `bun run i18n:locales`.
//
// The list of languages the app offers is TMDB's, not one this repo curates —
// there is no point offering a UI language for content TMDB can't describe in
// it. `/configuration/primary_translations` is that list: the locales TMDB
// actually holds translated titles and overviews for.
//
// It returns 144 *regional* tags (22 flavours of English, 15 of Spanish),
// which is a metadata distinction, not a UI one — nobody wants to pick between
// en-AG and en-BB to read a menu. So the tags are folded to one entry per
// language, keyed by the bare subtag (`sl`), while the full tag is kept as
// `language` and sent to TMDB as its `language` param
// (see `tmdb()` in app/utils/tmdb.ts). Picking which region represents a
// language is CLDR's job, not ours: `Intl.Locale#maximize` answers it (pt →
// pt-BR, zh → zh-CN, en → en-US), and `Intl` gives the endonym and the writing
// direction too, so no table of language names is ever hand-kept here.
//
// The output is i18n/i18n.locales.json, the single source of truth shared by
// nuxt.config.ts and scripts/i18n.ts. Adding a locale is running this; nothing
// else in the repo names a language.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'i18n', 'i18n.locales.json')
const DEFAULT = 'en'

/** Where the app is published from, so a language people read is never dropped. */
const TMDB = 'https://api.themoviedb.org/3/configuration/primary_translations'

interface Locale {
  code: string
  name: string
  language: string
  dir?: 'rtl'
  file: string
}

const token = process.env.TMDB_API
if (!token) {
  console.error('TMDB_API is not set — put a TMDB read token in .env (same one the app uses).')
  process.exit(1)
}

const tags: string[] = await fetch(TMDB, { headers: { Authorization: `Bearer ${token}` } })
  .then(r => r.ok ? r.json() : Promise.reject(new Error(`TMDB said ${r.status}`)))

// One bucket per language subtag; `ar-EG`, `ar-SA`… all land under `ar`.
const byLanguage = new Map<string, string[]>()
for (const tag of tags) {
  const code = tag.split('-')[0]!
  byLanguage.set(code, [...(byLanguage.get(code) ?? []), tag])
}

const locales: Locale[] = []
for (const [code, variants] of byLanguage) {
  const intl = new Intl.Locale(code)
  // CLDR's answer to "which country does this language mean, unqualified" —
  // only used when TMDB actually ships that variant, so `de` can't resolve to a
  // tag TMDB would reject.
  const likely = `${code}-${intl.maximize().region}`
  const language = variants.includes(likely) ? likely : variants[0]!
  const dir = (intl as { getTextInfo?: () => { direction: string } }).getTextInfo?.().direction

  locales.push({
    code,
    // The endonym — a language picker is read by someone who doesn't speak the
    // language it is currently in, so "Deutsch" is the only useful label.
    name: new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code,
    language,
    ...(dir === 'rtl' ? { dir: 'rtl' as const } : {}),
    file: `${code}.ts`,
  })
}

// Default first, then by the code the URL will carry, so a diff of this file
// reads as "which languages changed" rather than "what order TMDB replied in".
locales.sort((a, b) =>
  a.code === DEFAULT ? -1 : b.code === DEFAULT ? 1 : a.code.localeCompare(b.code))

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify({ defaultLocale: DEFAULT, locales }, null, 2)}\n`)

const rtl = locales.filter(l => l.dir === 'rtl').map(l => l.code)
console.log(`Wrote i18n/i18n.locales.json — ${locales.length} languages from ${tags.length} TMDB tags.`)
console.log(`Right-to-left: ${rtl.join(', ')}`)
console.log('Run `bun run i18n` to fill the catalogs.')
