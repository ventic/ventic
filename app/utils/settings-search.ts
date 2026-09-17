/**
 * Search across every settings page.
 *
 * The index is the pages themselves, read as source: each `<settings-section>`
 * is one result, and what it is found by is the `$t` keys written inside it —
 * its title, hint, the labels of its controls and every sentence under them. So
 * a setting is findable the day it is written, with nothing to register, and in
 * every language the app speaks, because each of those keys is already in 72
 * catalogs. A word list per language is the thing that would have gone stale.
 *
 * What a page never says in so many words ("dark mode", "kill switch") is a
 * section's `keywords` prop: translated like any other string, which is how
 * Android's own settings search does it.
 */

/** One `<settings-section>`, or what a page holds outside any, as translation keys. */
export interface SettingsEntry {
  path: string
  /** The `SECTIONS` value the page is listed under. */
  page: string
  /** The section's title — two keys where the page picks one per platform. A page entry's is its own name. */
  heading: string[]
  /** A title that is not a key (`title="Ventic"`). */
  name?: string
  /** The page, and the tab under it, a section sits on. */
  crumb: string[]
  /** The title keys to scroll to on arrival; empty lands at the top, which is where a literal title sits. */
  find: string[]
  keywords: string[]
  labels: string[]
  hint: string[]
  text: string[]
  /** The section's `v-if`, verbatim. */
  when?: string
}

/**
 * Sections a platform never draws, by the condition their page puts on them.
 * Anything else behind a `v-if` is state (a theme, a picture) the user can
 * change, so it stays findable. `check:settings-search` holds these names to
 * the pages.
 */
export const PLATFORM_SECTIONS: Record<string, () => boolean> = {
  canMeter: () => meteredNetwork() !== null,
  canHide: () => isDesktop(),
}

// --- Reading the pages ---------------------------------------------------------

// The scanner's own patterns (scripts/i18n.ts), so the index sees exactly the
// keys the catalogs hold.
const DOLLAR_T = /(?<![\w.])\$t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g
const KEYPATH = /\bkeypath\s*=\s*(['"])((?:\\.|(?!\1).)*?)\1/g
/** An opening tag whose attribute values may hold a `>` of their own (`v-if="a > b"`). */
const TAG = '((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>'
const SECTION = new RegExp(`<settings-section(?=[\\s>/])${TAG}`, 'g')
const BUTTON = new RegExp(`<v-btn(?=[\\s>])${TAG}([\\s\\S]*?)</v-btn>`, 'g')
/** A row of `SECTIONS` or of a page's tabs: `{ value: '…', title: () => $t('…'), … }`. */
const ROW = /\{ value: '([^']+)'[^\n]*\}/g

function unescape(raw: string) {
  return raw.replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c)
}

function keys(source = '') {
  return [...new Set([...source.matchAll(DOLLAR_T), ...source.matchAll(KEYPATH)].map(m => unescape(m[2]!)))]
}

/** As scripts/i18n.ts strips them: a commented-out string is no longer on the page. */
function stripComments(source: string) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
}

function attributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([:@#]?[\w.-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]))
}

/** What a control is called: a field's label, or the words on a button — but not one with a blank in it, since "{drive} · {free} free" is no headline. */
function labelsIn(template: string) {
  return [...new Set([
    ...[...template.matchAll(/:label="([^"]*)"/g)].flatMap(m => keys(m[1])),
    ...[...template.matchAll(BUTTON)].flatMap(m => keys(m[2])),
  ])].filter(key => !/\{\w+\}/.test(key))
}

/**
 * Every section of every settings page, from the pages' source (path → text).
 * `stores/settings.ts` comes along for the names of the pages.
 */
export function settingsEntries(files: Record<string, string>): SettingsEntry[] {
  // value → title key and keywords, for both `SECTIONS` and a page's tab list.
  const rows = new Map<string, { title: string, keywords: string[] }>()
  const pages: [string, string][] = []

  for (const [file, raw] of Object.entries(files)) {
    const source = stripComments(raw)
    for (const [row, value] of source.matchAll(ROW)) {
      const title = row.match(/title: \(\) => (\$t\('(?:\\.|[^'])*'\))/)?.[1]
      if (title)
        rows.set(value!, { title: keys(title)[0]!, keywords: keys(row.match(/keywords: \(\) => (\$t\('(?:\\.|[^'])*'\))/)?.[1]) })
    }
    if (file.endsWith('.vue'))
      pages.push([file.replace(/^.*\/pages/, '').replace(/(\/index)?\.vue$/, ''), source])
  }

  return pages.flatMap(([path, source]) => {
    const template = source.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
    const page = path.split('/')[2]
    const listed = page && rows.get(page)
    // `/settings` itself, and a shell whose tabs are pages of their own.
    if (!listed || /<nuxt-page\b/.test(template))
      return []

    // A tab's row is keyed by its path, a page's by its bare name.
    const tab = rows.get(path)
    const crumb = tab ? [listed.title, tab.title] : [listed.title]
    const sections: SettingsEntry[] = []
    const inside = new Set<string>()
    const controls = labelsIn(template)

    for (const open of template.matchAll(SECTION)) {
      const tag = open[1]!
      const at = attributes(tag)
      const end = open.index + open[0].length
      const body = tag.trimEnd().endsWith('/') ? '' : template.slice(end, template.indexOf('</settings-section>', end))
      const labels = labelsIn(body)
      const heading = keys(at[':title'])
      for (const key of keys(open[0] + body))
        inside.add(key)
      sections.push({
        path,
        page,
        heading,
        name: at.title,
        crumb,
        find: heading,
        keywords: keys(at[':keywords']),
        labels,
        hint: keys(at[':hint']),
        text: keys(body).filter(k => !labels.includes(k)),
        when: at['v-if'] ?? at['v-else-if'],
      })
    }

    // The page itself goes first, so a search for its name lands on it before
    // any of its sections.
    const own = tab ?? listed
    return [{
      path,
      page,
      heading: [own.title],
      crumb: tab ? [listed.title] : [],
      find: [],
      keywords: own.keywords,
      // "Reset to defaults" under the last section is the page's own button.
      labels: controls.filter(k => !inside.has(k)),
      hint: [],
      text: keys(source).filter(k => !inside.has(k) && !controls.includes(k)),
    }, ...sections]
  })
}

/** The pages' source, fetched once and only when somebody first searches. */
let sources: Promise<Record<string, string>> | undefined
export function settingsSources() {
  sources ??= Promise.all(Object.entries(import.meta.glob<string>(
    ['../pages/settings/**/*.vue', '../stores/settings.ts'],
    { query: '?raw', import: 'default' },
  )).map(async ([file, load]) => [file, await load()] as const)).then(Object.fromEntries)
  return sources
}

// --- Matching --------------------------------------------------------------------

interface Field {
  weight: number
  words: string[]
  /**
   * Each run between spaces with its punctuation gone, so "wifi" is found in
   * "Wi-Fi" and "größe" in "Postergröße" — but nothing across a space, where
   * "hdr" would be found in "which drive".
   */
  squashed: string
  /** A translation, which takes the looser matches; its English original only takes whole words and prefixes. */
  loose: boolean
  /** Shown as the result's headline when this field matched better than the heading did. */
  label?: string
  heading?: boolean
}

export interface SettingsDoc {
  path: string
  /** The section's title as the page draws it, in the language on screen. */
  find: string[]
  page: string
  heading: string
  crumb: string[]
  fields: Field[]
}

export interface SettingsHit {
  doc: SettingsDoc
  score: number
  /** The label that matched, when one did better than the heading. */
  label?: string
}

// A label is what is on screen; a keyword only what someone might call it.
const WEIGHT = { heading: 10, label: 8, keywords: 6, crumb: 5, hint: 3, text: 2 }
/** An English original, matched for anyone who searches in English whatever the app is in. */
const ENGLISH = 0.6
/** Results scoring under this share of the best one are noise beside it. */
const CUT = 0.3

/** Letters with no decomposition that a keyboard is unlikely to type. */
const LETTERS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', þ: 'th' }
/** Scripts written without spaces, where a word can sit anywhere inside a run. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
const NOT_WORD = /[^\p{L}\p{N}\p{M}]+/gu

/**
 * One spelling for everything a person might type for the same letter: accents
 * off ("č" is "c", "é" is "e"), full-width forms narrowed, and katakana read as
 * hiragana, which is what a Japanese keyboard shows before it converts.
 */
export function foldForSearch(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[ßæœøđðłıþ]/g, c => LETTERS[c]!)
    // ァ to ヶ each have a hiragana twin 0x60 below; ー and the few after ヶ don't.
    .replace(/\p{Script=Katakana}/gu, c => {
      const code = c.charCodeAt(0)
      return code >= 0x30A1 && code <= 0x30F6 ? String.fromCharCode(code - 0x60) : c
    })
}

const segmenters = new Map<string, Intl.Segmenter | null>()

const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u

/**
 * Words, in the language they are written in. Chinese, Japanese and Thai put no
 * spaces between words, so a split on spaces reads a whole sentence as one —
 * `Intl.Segmenter` knows where their words end, and is what lets "字幕大小"
 * find a "大小" under "字幕".
 *
 * Except for a query that is kana alone: that is a word spelt out phonetically,
 * "ふぉんと" for フォント, which the dictionary has never seen and cuts into single
 * syllables that are found everywhere.
 */
function words(text: string, locale: string, query = false) {
  if (!segmenters.has(locale))
    segmenters.set(locale, 'Segmenter' in Intl ? new Intl.Segmenter(locale, { granularity: 'word' }) : null)
  // Lower-cased in its own language first — Turkish has two i's — then folded.
  const lower = text.toLocaleLowerCase(locale)
  const segmenter = segmenters.get(locale)
  const parts = lower.split(/\s+/).flatMap(run => !segmenter || (query && KANA.test(run))
    ? [run]
    : [...segmenter.segment(run)].filter(s => s.isWordLike).map(s => s.segment))
  return parts.flatMap(part => foldForSearch(part).split(NOT_WORD)).filter(Boolean)
}

function field(text: string, locale: string, weight: number, loose: boolean, label?: string): Field {
  const plain = text.replace(/\{\w+\}/g, ' ')
  const squashed = foldForSearch(plain.toLocaleLowerCase(locale)).split(/\s+/).map(run => run.replace(NOT_WORD, '')).join(' ')
  return { weight, words: [...new Set(words(plain, locale))], squashed, loose, label }
}

/**
 * The entries in the language on screen, ready to search. `t` is `$t` in the
 * app; a key it hands back unchanged is English already, and isn't added twice.
 */
export function settingsDocs(entries: SettingsEntry[], t: (key: string) => string, locale: string): SettingsDoc[] {
  return entries.map(entry => {
    const fields: Field[] = []
    const add = (keys: string[], weight: number, label = false) => {
      const own = keys.map(t)
      const english = keys.filter((key, i) => own[i] !== key)
      if (label) {
        own.forEach(text => fields.push(field(text, locale, weight, true, text)))
        english.forEach(key => fields.push(field(key, 'en', weight * ENGLISH, false, t(key))))
      }
      else if (keys.length) {
        fields.push(field(own.join('\n'), locale, weight, true))
        if (english.length)
          fields.push(field(english.join('\n'), 'en', weight * ENGLISH, false))
      }
    }
    add(entry.heading, WEIGHT.heading)
    if (entry.name)
      fields.push(field(entry.name, locale, WEIGHT.heading, true))
    for (const f of fields)
      f.heading = true
    add(entry.keywords, WEIGHT.keywords)
    add(entry.labels, WEIGHT.label, true)
    add(entry.crumb, WEIGHT.crumb)
    add(entry.hint, WEIGHT.hint)
    add(entry.text, WEIGHT.text)
    return {
      path: entry.path,
      find: entry.find.map(t),
      page: entry.page,
      heading: entry.name ?? t(entry.heading[0]!),
      crumb: entry.crumb.map(t),
      fields,
    }
  })
}

/** Within `k` typos, a swapped pair of letters being one (optimal string alignment). */
function near(a: string, b: string, k: number) {
  if (Math.abs(a.length - b.length) > k)
    return false
  let before: number[] = []
  let last = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(last[j]! + 1, row[j - 1]! + 1, last[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, before[j - 2]! + 1)
      row.push(d)
    }
    if (Math.min(...row) > k)
      return false
    before = last
    last = row
  }
  return last[b.length]! <= k
}

/**
 * The same word with a different ending: "podnapisov" is "Podnapisi", "шрифта"
 * is "Шрифт". Most of the languages here inflect at the end of a word, and a
 * shared start this long with only an ending's worth left over is that, in any
 * of them, without a stemmer per language.
 */
function sameStem(a: string, b: string) {
  let common = 0
  while (common < a.length && a[common] === b[common])
    common++
  return common >= 5 && a.length - common <= 3 && b.length - common <= 3
}

/** How well one typed word matches a field, 0 to 1. */
function quality(token: string, f: Field, typos: boolean) {
  let best = 0
  for (const word of f.words) {
    if (word === token)
      return 1
    if (word.startsWith(token))
      best = 0.8
    else if (!best && sameStem(token, word))
      best = 0.6
  }
  if (best || !f.loose)
    return best
  const unspaced = UNSPACED.test(token)
  if ((token.length >= 3 || unspaced) && f.squashed.includes(token))
    return 0.5
  if (typos && !unspaced && token.length >= 4) {
    const k = token.length >= 8 ? 2 : 1
    // A slip inside a word of the same length ("fnot") before a word with a
    // letter more or less ("not"), or the start of a longer one.
    if (f.words.some(word => word.length === token.length && near(token, word, k)))
      return 0.4
    // Short of six letters, only a letter left out ("colr"): "tray" is also a
    // letter more than "try", and a letter off the start of "tracking",
    // "transfer" and "translate".
    const long = token.length >= 6
    if (f.words.some(word => ((long || word.length >= token.length) && near(token, word, k)) || (long && word.length > token.length && near(token, word.slice(0, token.length), k))))
      return 0.3
  }
  return 0
}

/**
 * Rank the docs for what was typed. Every word counts by how rare it is across
 * the whole of Settings, so "how do I change the subtitle font" is decided by
 * "subtitle" and "font" and not by "the" — which is what a stop-word list would
 * do, in one language. A word that matches nothing as typed is tried again
 * allowing for typos; one that does match is not, or every typo-distance
 * neighbour of a real word would crowd the results.
 */
export function searchSettings(docs: SettingsDoc[], query: string, locale: string): SettingsHit[] {
  const tokens = [...new Set(words(query, locale, true))]
  if (!tokens.length)
    return []

  const sums = docs.map(() => ({ score: 0, matched: 0, fields: new Map<Field, number>() }))
  let weight = 0
  for (const token of tokens) {
    const per = (typos: boolean) => docs.map(doc => doc.fields.map(f => f.weight * quality(token, f, typos)))
    let found = per(false)
    if (!found.some(fields => fields.some(Boolean)))
      found = per(true)
    const df = found.filter(fields => fields.some(Boolean)).length
    // Squared: across one screen of settings the plain ratio is too flat to
    // tell "the" (in nearly everything) from "font" (in one place).
    const idf = Math.log(1 + docs.length / (1 + df)) ** 2
    weight += idf
    found.forEach((fields, i) => {
      const best = Math.max(0, ...fields)
      if (!best)
        return
      const sum = sums[i]!
      sum.score += idf * best
      sum.matched += idf
      fields.forEach((score, j) => score && sum.fields.set(docs[i]!.fields[j]!, (sum.fields.get(docs[i]!.fields[j]!) ?? 0) + score))
    })
  }

  const hits = docs
    .map((doc, i) => {
      const { score, matched, fields } = sums[i]!
      // A doc holding every word beats one holding some — counted by rarity
      // too, or the one that holds "how", "do" and "the" wins.
      const hit: SettingsHit = { doc, score: score * matched / weight }
      // Keywords and prose say which section; only a label says what to call it.
      let top = Math.max(0, ...[...fields].filter(([f]) => f.heading).map(([, total]) => total))
      for (const [f, total] of fields) {
        if (f.label && total > top) {
          top = total
          hit.label = f.label
        }
      }
      return hit
    })
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score)

  // A section the page draws one of two ways is indexed twice, and a page can be
  // named after its only section; one result will do for either.
  const seen = new Set<string>()
  return hits.filter(hit => {
    const key = `${hit.doc.path}#${hit.doc.heading}`
    return hit.score >= hits[0]!.score * CUT && !seen.has(key) && seen.add(key)
  })
}
