// Translation key sync: `bun run i18n`.
//
// You write `$t('Some text')` anywhere in app/ — template, script, .ts util,
// store — and run this. It scans every key out of the source and rebuilds
// i18n/locales/<code>.ts for all 72 languages. Nothing here is edited by hand
// and nothing has to be imported: `$t` is auto-imported from app/utils/i18n.ts
// in script, and vue-i18n injects it into every template, so a call site is
// finished the moment it is typed.
//
// VALUE-AS-KEY — the key IS the English text, so `en.ts` maps each key to
// itself and English can never drift out of sync with the source. Every other
// locale gets `TODO_TRANSLATION: <key>` until it is filled in — that prefix is
// what an AI pass looks for, and what `--check` counts. It is also stripped at
// runtime (see i18n/i18n.config.ts), so an untranslated string renders as the
// English text rather than as a marker on someone's screen.
//
// ALL KEYS ARE GLOBAL. There are no per-component <i18n> blocks and no local
// composers to decide between: one catalog per language, one lookup, one place
// an AI translation pass has to read. That is why this file is a fraction of
// the size of the version it grew from — sharing a key across components is the
// default rather than a promotion the script has to work out.
//
// FLAT KEYS. Keys are English sentences, so they contain `.` — which vue-i18n
// would otherwise read as a path separator ("Nothing to play yet." → the empty
// key inside "Nothing to play yet"). i18n.config.ts swaps in a resolver that
// tries the literal key first for that reason, and only walks a dotted path
// when that misses — which is what still finds Vuetify's nested `$vuetify`.
//
// VUETIFY'S STRINGS come along for free, and are never copied. With
// @nuxtjs/i18n installed, vuetify-nuxt-module routes Vuetify's own labels
// through vue-i18n instead of through Vuetify's locale files — so without them
// a Vuetify component renders raw `$vuetify.noDataText`. Each generated file
// therefore *imports* them (`import { sl as $vuetify } from 'vuetify/locale'`)
// rather than inlining 200 strings 72 times: nothing to translate, nothing to
// re-sync when Vuetify adds a component, and the bundler drops the 71 locales
// that aren't loaded. That is why these files are `.ts` and not `.json`.
//
// Vuetify ships only 39 of the 72, and the other 33 got a raw `$vuetify.close`
// on screen. Those have a hand-written object in `i18n/vuetify/<code>.ts`,
// which this script imports the same way — it never reads, rewrites or deletes
// one, so a translation put there survives every run. They are deliberately
// partial: the keys Vuetify components we actually mount can render, and
// nothing else, because a missing path falls back to English one key at a time
// (see i18n/vuetify/README.md).
//
// Limitations: keys must be string literals — `$t(name)` can't be scanned.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import process from 'node:process'
import * as vuetifyLocales from 'vuetify/locale'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'app')
const LOCALES_DIR = join(ROOT, 'i18n', 'locales')
const TODO = 'TODO_TRANSLATION: '
const IGNORE = new Set(['node_modules', '.nuxt', '.output', 'dist'])

const { defaultLocale, locales } = JSON.parse(
  readFileSync(join(ROOT, 'i18n', 'i18n.locales.json'), 'utf8'),
) as { defaultLocale: string, locales: { code: string, name: string, file: string }[] }

/** Report what is missing and exit non-zero; used by `bun run check:i18n`. */
const CHECK = process.argv.includes('--check')

// --- scanning -------------------------------------------------------------
// `$t('…')`, `$t("…")`, `$t(`…`)`. The lookbehind keeps `foo.$t(` and `x$t(`
// out; group 2 is always the key.
const DOLLAR_T = /(?<![\w.])\$t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g
// <I18nT keypath="…"> — the only way to put a component inside a translated
// sentence, so its keypath is a usage like any other.
const KEYPATH = /\bkeypath\s*=\s*(['"])((?:\\.|(?!\1).)*?)\1/g

/**
 * Comments are stripped from the *scan copy* only. A commented-out call should
 * stop holding its key alive, or every string ever written stays in 72 files
 * for ever.
 */
function stripComments(source: string) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Not preceded by a colon, or `https://` inside a key ends the string
    // early and the rest of the sentence is never scanned.
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
}

/**
 * Undo the escaping a string literal carries, so the key matches what vue-i18n
 * is handed at runtime — eslint rewrites `$t("a b's c")` to `$t('a b\'s c')`
 * and the catalog has to hold the unescaped form either way.
 */
function unescape(raw: string) {
  return raw.replace(/\\(.)/g, (_, c) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c)
}

function keysIn(source: string, into: Map<string, string[]>, file: string) {
  for (const re of [DOLLAR_T, KEYPATH]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(source)) !== null) {
      const key = unescape(m[2]!)
      into.set(key, [...(into.get(key) ?? []), file])
    }
  }
}

function walk(dir: string, acc: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORE.has(entry.name) && !entry.name.startsWith('.'))
        walk(path, acc)
    }
    else if (['.vue', '.ts'].includes(extname(entry.name))) {
      acc.push(path)
    }
  }
  return acc
}

const files = walk(SRC).sort()
const usage = new Map<string, string[]>()
for (const file of files)
  keysIn(stripComments(readFileSync(file, 'utf8')), usage, relative(ROOT, file))

const keys = [...usage.keys()].sort()

// --- Vuetify's own strings ------------------------------------------------
/**
 * Which `vuetify/locale` export covers one of our language codes. Identity for
 * all but three: Vuetify names Chinese and Serbian by script, and files
 * Norwegian Bokmål under plain `no`.
 */
const VUETIFY_ALIAS: Record<string, string> = { zh: 'zhHans', sr: 'srCyrl', nb: 'no' }
const OURS = join(ROOT, 'i18n', 'vuetify')

/**
 * The import line a catalog needs for Vuetify's own labels: Vuetify's export
 * where it has one, ours where it doesn't, and nothing at all (English at
 * runtime) for a language neither covers.
 */
function vuetifyImport(code: string) {
  const name = VUETIFY_ALIAS[code] ?? code
  if (name in vuetifyLocales)
    return `import { ${name} as $vuetify } from 'vuetify/locale'`
  return existsSync(join(OURS, `${code}.ts`))
    ? `import $vuetify from '../vuetify/${code}'`
    : null
}

/**
 * Ours are hand-written, so a typo'd key is a string that silently never
 * renders. Vuetify's English catalog is the shape they have to match.
 */
async function checkOurs() {
  const bad: string[] = []
  for (const entry of existsSync(OURS) ? readdirSync(OURS) : []) {
    if (extname(entry) !== '.ts')
      continue
    const mod = await import(join(OURS, entry))
    const walkKeys = (node: unknown, reference: unknown, path: string) => {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const there = (reference as Record<string, unknown> | undefined)?.[key]
        if (there === undefined)
          bad.push(`${entry}: ${path}${key}`)
        else if (typeof value === 'object' && value)
          walkKeys(value, there, `${path}${key}.`)
      }
    }
    walkKeys(mod.default ?? {}, vuetifyLocales.en, '')
  }
  return bad
}

// --- write ----------------------------------------------------------------
function isTranslated(value: unknown) {
  return typeof value === 'string' && value !== '' && !value.startsWith(TODO)
}

/**
 * What the last run wrote, so a finished translation is never overwritten.
 * These are modules rather than data, so they are imported rather than parsed —
 * `$vuetify` comes along and is dropped, being Vuetify's to keep up to date.
 */
async function previous(file: string): Promise<Record<string, string>> {
  if (!existsSync(file))
    return {}
  try {
    // Cache-busted: the same path is re-read on every run of a watch loop.
    const mod = await import(`${file}?t=${Date.now()}`)
    const { $vuetify: _, ...rest } = mod.default ?? {}
    return rest
  }
  catch (error) {
    console.warn(`  WARN  could not read ${relative(ROOT, file)} (${(error as Error).message}) — rebuilding it.`)
    return {}
  }
}

mkdirSync(LOCALES_DIR, { recursive: true })

let changed = 0
const pending: string[] = []

for (const { code, name } of locales) {
  const file = join(LOCALES_DIR, `${code}.ts`)
  const prev = await previous(file)
  const isDefault = code === defaultLocale
  const vuetify = vuetifyImport(code)

  const entries = keys.map(key => [
    key,
    isDefault ? key : isTranslated(prev[key]) ? prev[key]! : TODO + key,
  ] as const)

  const todo = entries.filter(([, value]) => !isDefault && !isTranslated(value)).length
  if (todo)
    pending.push(`${code} (${name}): ${todo}`)

  const body = entries.map(([key, value]) =>
    `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n')

  const content = [
    `// ${name} — generated by \`bun run i18n\`. Translate the values; nothing else.`,
    '// Keys are the English text, so a key is also its own English translation.',
    vuetify,
    '',
    'export default {',
    // Vuetify's own component strings, already translated by Vuetify and
    // imported rather than copied — see the note at the top of this script.
    vuetify ? '  $vuetify,' : null,
    body || null,
    '}',
    '',
  ].filter(line => line !== null && line !== false).join('\n')

  if ((existsSync(file) ? readFileSync(file, 'utf8') : null) !== content) {
    if (!CHECK)
      writeFileSync(file, content)
    changed++
  }
}

// --- report ---------------------------------------------------------------
// vue-i18n compiles a message as it renders it, and `|` splits plural forms
// while `@:` links to another key. A key is also its own English value, so a
// pipe in the source text turns into a plural table nobody wrote.
const risky = keys.filter(k => /\||@:|@\./.test(k))
for (const key of risky)
  console.warn(`  WARN  "${key}" contains vue-i18n syntax (| or @:) — use a different wording, or it renders wrong.`)

const sources = locales.map(l => vuetifyImport(l.code))
const theirs = sources.filter(line => line?.includes('vuetify/locale')).length
const ours = sources.filter(line => line?.includes('../vuetify/')).length
console.log(`${keys.length} key(s) across ${files.length} file(s) → ${locales.length} locales `
  + `(Vuetify's own strings: ${theirs} from Vuetify, ${ours} from i18n/vuetify, `
  + `${locales.length - theirs - ours} falling back to English).`)

const strayVuetify = await checkOurs()
for (const stray of strayVuetify)
  console.warn(`  WARN  i18n/vuetify/${stray} is not a key Vuetify has — it would never render.`)

if (CHECK) {
  if (changed)
    console.error(`\n${changed} locale file(s) are out of date. Run \`bun run i18n\`.`)
  if (pending.length)
    console.log(`\nUntranslated: ${pending.join(', ')}`)
  process.exit(changed || risky.length || strayVuetify.length ? 1 : 0)
}

console.log(`${changed} file(s) written.`)
if (pending.length) {
  console.log(`\nStill untranslated (${TODO.trim()} lines to fill):`)
  console.log(`  ${pending.join('\n  ')}`)
}
