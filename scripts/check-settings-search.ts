// Self-check for the settings search: `bun scripts/check-settings-search.ts`.
//
// The search reads the settings pages' own source (utils/settings-search.ts),
// so it can break without anything failing to compile: a page written in a shape
// the reader doesn't follow simply drops out of the results, and a change to the
// ranking shows up as the wrong first result in a language nobody here reads.
// Both are held here — the ranking against the real catalogs, because a query in
// Japanese or Russian landing is only true of the words those files hold.
import assert from 'node:assert'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { foldForSearch, PLATFORM_SECTIONS, searchSettings, settingsDocs, settingsEntries } from '../app/utils/settings-search'

const APP = fileURLToPath(new URL('../app', import.meta.url))

// Keyed the way `import.meta.glob` keys them in the app: relative to app/utils.
const files: Record<string, string> = {}
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      walk(path)
    else if (name.endsWith('.vue'))
      files[`..${path.slice(APP.length)}`] = readFileSync(path, 'utf8')
  }
}
walk(join(APP, 'pages/settings'))
files['../stores/settings.ts'] = readFileSync(join(APP, 'stores/settings.ts'), 'utf8')

const util = readFileSync(join(APP, 'utils/settings-search.ts'), 'utf8')
for (const glob of ['../pages/settings/**/*.vue', '../stores/settings.ts'])
  assert(util.includes(`'${glob}'`), `settingsSources() no longer loads ${glob} — this check reads the files the app does`)

const entries = settingsEntries(files)

// --- Reading the pages ---------------------------------------------------------

// By path: a tab shell (appearance.vue) and its first tab (appearance/index.vue)
// are two files at one URL.
const drawn = new Map<string, number>()
for (const [file, source] of Object.entries(files)) {
  const path = file.slice('../pages'.length).replace(/(\/index)?\.vue$/, '')
  drawn.set(path, (drawn.get(path) ?? 0) + (source.replace(/<!--[\s\S]*?-->/g, '').match(/<settings-section[\s>/]/g)?.length ?? 0))
}
for (const [path, count] of drawn) {
  const read = entries.filter(e => e.path === path && (e.find.length || e.name)).length
  assert.strictEqual(read, count, `${path}: ${count} <settings-section>s on the page, ${read} found by the search — a section it can't read is a section nobody can find`)
}

for (const entry of entries) {
  const where = `${entry.path} "${entry.heading[0] ?? entry.name}"`
  assert(entry.heading.length || entry.name, `${entry.path}: a section with no title the search can read`)
  assert(entry.crumb.every(Boolean), `${where}: a page or tab with no title the search can read`)
  for (const label of entry.labels)
    assert(!/\{\w+\}/.test(label), `${where}: "${label}" has a blank in it and would be shown as a headline`)
}

const pages = new Set(entries.map(e => e.page))
for (const [, value] of files['../stores/settings.ts']!.matchAll(/\{ value: '(\w+)'/g))
  assert(pages.has(value!), `SECTIONS lists "${value}", but no settings page for it was read`)

// The names are the pages' own variables, so a rename there silently puts a
// section back into every platform's results.
const conditions = new Set(entries.map(e => e.when))
for (const name of Object.keys(PLATFORM_SECTIONS))
  assert(conditions.has(name), `PLATFORM_SECTIONS names "${name}", which no longer guards any section`)

// --- One spelling per letter -----------------------------------------------------

assert.strictEqual(foldForSearch('Größe'), 'Grosse', 'ß is ss')
assert.strictEqual(foldForSearch('prenašaj'), 'prenasaj', 'an accent comes off')
assert.strictEqual(foldForSearch('ıi'), 'ii', 'Turkish dotless i is an i')
assert.strictEqual(foldForSearch('フォント'), 'ふぉんと', 'katakana reads as hiragana')
assert.strictEqual(foldForSearch('ＶＰＮ'), 'VPN', 'full-width letters are narrowed')

// --- Ranking ---------------------------------------------------------------------

const TODO = 'TODO_TRANSLATION: '
const catalogs = new Map<string, (key: string) => string>()
async function docsIn(code: string, keep = (_: typeof entries[number]) => true) {
  if (!catalogs.has(code)) {
    const catalog = (await import(`../i18n/locales/${code}.ts`)).default as Record<string, unknown>
    catalogs.set(code, key => {
      const value = catalog[key]
      return typeof value === 'string' && !value.startsWith(TODO) ? value : key
    })
  }
  return { docs: settingsDocs(entries.filter(keep), catalogs.get(code)!, code), t: catalogs.get(code)! }
}

/**
 * What the first result must be: the heading's key, and the key of the label
 * shown instead of it when a control is what matched. By key, so a better
 * translation tomorrow doesn't fail this.
 */
const FIRST: [locale: string, query: string, heading: string, label?: string][] = [
  ['en', 'vpn', 'VPN'],
  ['en', 'dark mode', 'Theme'],
  ['en', 'subtitle size', 'Text', 'Size'],
  ['en', 'how do i change the subtitle font', 'Text', 'Font'],
  ['en', 'subtitel', 'Subtitles'],
  ['en', 'fnot', 'Text', 'Font'],
  ['en', 'wifi', 'Mobile data', 'Only download on Wi-Fi'],
  ['en', 'tray', 'Closing the window'],
  ['en', 'zoom', 'Size'],
  ['en', 'hotkeys', 'Shortcuts'],
  ['en', 'css', 'Display', 'Global CSS'],
  ['en', 'clear history', 'Watch history', 'Clear watch history'],
  ['en', 'poster', 'Size', 'Poster size'],
  ['en', 'where are my downloads saved', 'Where downloads go'],
  ['en', 'can\'t hear dialogue', 'Dialogue'],
  // A letter per word, and a compound.
  ['sl', 'podnapisi', 'Subtitles'],
  ['sl', 'prenasaj', 'Mobile data', 'Only download on Wi-Fi'],
  ['sl', 'velikost podnapisov', 'Text', 'Size'],
  ['sl', 'omejitev hitrosti', 'Speed limits'],
  // English still finds things whatever the app is in.
  ['sl', 'vpn', 'VPN'],
  ['sl', 'dark mode', 'Theme'],
  ['de', 'grosse', 'Size'],
  ['de', 'postergrosse', 'Size', 'Poster size'],
  ['de', 'wlan', 'Mobile data', 'Only download on Wi-Fi'],
  ['de', 'größe der untertitel', 'Text', 'Size'],
  // No spaces between words, and a word spelt in kana.
  ['ja', '字幕サイズ', 'Text', 'Size'],
  ['ja', 'ふぉんと', 'Text', 'Font'],
  ['zh', '字幕大小', 'Text', 'Size'],
  ['zh', '备份', 'Backup'],
  ['th', 'ขนาดคำบรรยาย', 'Text', 'Size'],
  // An ending the catalog never has.
  ['ru', 'шрифта', 'Text', 'Font'],
  ['ru', 'ограничение скорости', 'Speed limits'],
  // Without the article, and half a syllable.
  ['ar', 'خلفية', 'Background'],
  ['ar', 'حجم الخط', 'Text', 'Font'],
  ['ko', '자마', 'Subtitles'],
  ['ko', '글꼴 크기', 'Text', 'Font'],
  ['tr', 'altyazi', 'Choosing subtitles'],
  ['tr', 'yazı tipi', 'Text', 'Font'],
  // With and without the nukta.
  ['hi', 'फॉन्ट', 'Text', 'Font'],
]

for (const [code, query, heading, label] of FIRST) {
  const { docs, t } = await docsIn(code)
  const [first] = searchSettings(docs, query, code)
  const got = first ? `${first.doc.heading}${first.label ? ` / ${first.label}` : ''}` : 'nothing'
  const want = `${t(heading)}${label ? ` / ${t(label)}` : ''}`
  assert.strictEqual(got, want, `${code} "${query}": expected ${want} first`)
}

// A section this platform never draws is left out before searching, and the
// words it held must not drag in whatever is one typo away from them.
{
  const { docs } = await docsIn('en', e => e.when !== 'canHide')
  const hits = searchSettings(docs, 'tray', 'en')
  assert.deepStrictEqual(hits.map(h => h.doc.heading), [], '"tray" with no tray to close to finds nothing, not "tracking" and "transfer"')
}

// And nothing typed is nothing found, rather than everything.
{
  const { docs } = await docsIn('en')
  assert.deepStrictEqual(searchSettings(docs, '  — ', 'en'), [], 'punctuation alone matches nothing')
}
