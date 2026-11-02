/**
 * External subtitles, for the releases that ship none.
 *
 * Same trick as the torrent search: a Stremio addon fronts OpenSubtitles behind
 * one CORS-enabled JSON GET keyed by IMDb id — no API key, no account — and the
 * files come back already re-encoded to UTF-8, which is what mpv wants.
 *
 * The host below is Stremio's, and no agreement sits behind that: it is a
 * public unauthenticated endpoint we are a guest on, and it may start refusing
 * us at any time. So `findSubtitles` throws instead of degrading and the caller
 * plays on without subtitles. It stays first because its files cost nothing.
 *
 * It is also a small and stale copy. Measured 2026-11-01: thirteen files in
 * nine languages for Harry Potter and the Philosopher's Stone, no English among
 * them, where opensubtitles.org itself holds 27 in Slovenian alone. Nothing we
 * send changes that, so the depth comes from three other places:
 *
 * - OpenSubtitles' own API (`searchOpenSubtitles`), with the app's key from the
 *   build, as TMDB's is. One key is safe to share there because the quota
 *   isn't the key's alone: a download without a login is counted against the
 *   key *and the address* (the counter it reports is `app_<key>_<ip>`), five a
 *   day on the free tier — so every household has its own five. Its "under
 *   dev" switch would make that one pool of 100 for every install; leave it
 *   off. Its old .org API takes no new apps since 2022, and the site itself is
 *   captchas — there is no third way in.
 * - SubDL, with a key the user pastes into Settings → Subtitles. There the key
 *   is* the quota, 50 downloads a day, so it can only ever be theirs.
 * - Their own sources, since a Stremio addon serves `/subtitles/` off the same
 *   base as `/stream/`.
 *
 * What this endpoint does *not* give is the thing that would settle everything:
 * it matches on the IMDb id alone and hands back a url, a language and an
 * encoding — no release name, no hearing-impaired flag, and it ignores the
 * `videoHash`/`filename` extras that would pin a file to this exact copy
 * (verified: a bogus hash returns the identical list). So the file itself is
 * the evidence. `probe` downloads it, and the cues answer what the listing
 * won't: how long it runs, how many lines it has, and whether it is the
 * captioned cut — see `fitsRuntime`.
 */
import type { Steps } from './steps'
import { getVersion } from '@tauri-apps/api/app'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { reactive } from 'vue'
import { mirrored } from './cast'
import { shelve, shelved } from './shelf'
import { imdbIdByTitle, runtimeText } from './tmdb'
import { configuredSources, parseRelease } from './torrents'

const ADDON = 'https://opensubtitles-v3.strem.io'
const SUBDL = 'https://api.subdl.com/api/v1'
/** Where SubDL's listing points its relative `url`s — archives, not subtitle files. */
const SUBDL_FILES = 'https://dl.subdl.com'
const OPENSUBTITLES = 'https://api.opensubtitles.com/api/v1'
const SUBSOURCE = 'https://api.subsource.net/api/v1'
/**
 * The metadata addon behind Stremio's search box. It indexes IMDb itself,
 *  which is the whole reason `findImdbId` still needs it.
 */
const CINEMETA = 'https://v3-cinemeta.strem.io'

export interface Subtitle {
  id: string
  /**
   * Where the file is, which mpv opens over http itself — unless it is
   * `metered`, when it may be an archive or a page. Also what makes it this
   * file: two entries with one url are one.
   */
  url: string
  /** OpenSubtitles' 3-letter code: ISO 639-2/B and /T mixed, plus its own. */
  lang: string
  /**
   * What the provider called the file, when it says at all — the release name
   * is the one thing that tells you a file was cut for *this* encode.
   *
   * The built-in addon never says: its entries carry a url, a language and an
   * encoding and nothing else, which is why `fileLabel` has a whole second way
   * of describing a file. Other addons do, so it is read where it is offered.
   */
  name?: string
  /**
   * Fetching it spends one of a daily quota — SubDL's 50 a key (the key is in
   * the url), OpenSubtitles' per address — so it is listed unread and read only
   * once played (`probeLanguage`). mpv is handed the text we read rather than
   * the url: SubDL's are ZIPs, which it can't open over http (`mpvSource`).
   */
  metered?: boolean
  /** Who a metered file is from: until it is read, the only thing its row can say. */
  provider?: string
  /** How to fetch it, where that is more than a GET of `url`. */
  download?: () => Promise<Uint8Array>
  /** The provider's own word that this is the hearing-impaired cut, until the file is read. */
  captions?: boolean
  /** The episode to take out of an archive that holds a whole season. */
  episode?: number
}

/** The codes Intl doesn't know, because OpenSubtitles invented them. */
const EXTRA_NAMES: Record<string, () => string> = {
  pob: () => $t('Portuguese (Brazil)'),
  zht: () => $t('Chinese (traditional)'),
  zhe: () => $t('Chinese (bilingual)'),
}

/**
 * One `Intl.DisplayNames` per UI language, built on first use.
 *
 * The locale comes off `<html lang>` rather than from `useI18n`, because this
 * file is also loaded outside Nuxt by `bun run check:subtitles` — and because
 * `langName` is called while *matching* a downloaded file against a muxed
 * track, which is not always inside a component. Either way both sides of a
 * comparison go through here, so they agree whatever the language is.
 */
const NAMES = new Map<string, Intl.DisplayNames>()

function displayNames() {
  const locale = globalThis.document?.documentElement.lang || 'en'
  let names = NAMES.get(locale)
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: 'language' })
    NAMES.set(locale, names)
  }
  return names
}

/**
 * "eng" -> "English". Also how a downloaded subtitle is matched against a track
 * muxed into the file: mkv says "ger", OpenSubtitles says "deu", and only the
 * name they both resolve to can tell you those are the same language.
 */
export function langName(code: string) {
  const c = code.toLowerCase()
  if (EXTRA_NAMES[c])
    return EXTRA_NAMES[c]()
  try {
    const name = displayNames().of(c)
    return name && name !== c ? name : code
  }
  catch {
    return code // not a language tag at all
  }
}

/**
 * What each of OpenSubtitles' own codes above is a variety of, for the one thing
 * that wants the language rather than the variety: its flag.
 */
const VARIETY_OF: Record<string, string> = { pob: 'pt', zht: 'zh', zhe: 'zh' }

/**
 * ISO 639-2/B, which OpenSubtitles and mkv both write and `Intl` leaves as it
 * is — it canonicalises "slv" to "sl" but not "ger" to "de". A closed list.
 */
const BIBLIOGRAPHIC: Record<string, string> = {
  alb: 'sq',
  arm: 'hy',
  baq: 'eu',
  bur: 'my',
  chi: 'zh',
  cze: 'cs',
  dut: 'nl',
  fre: 'fr',
  geo: 'ka',
  ger: 'de',
  gre: 'el',
  ice: 'is',
  mac: 'mk',
  mao: 'mi',
  may: 'ms',
  per: 'fa',
  rum: 'ro',
  slo: 'sk',
  tib: 'bo',
  wel: 'cy',
}

/**
 * The two-letter code for any code a language arrives as: "slv", "ger", "sl",
 * "en-US". OpenSubtitles' own varieties stay as they are, since the two-letter
 * code would lose the variety. '' for anything that isn't a language tag.
 */
function shortCode(code: string) {
  const c = code.toLowerCase()
  if (VARIETY_OF[c])
    return c
  try {
    return BIBLIOGRAPHIC[c] ?? Intl.getCanonicalLocales(c)[0]!.split('-')[0]!
  }
  catch {
    return ''
  }
}

/** SubDL's codes for OpenSubtitles' two varieties; every other one is `shortCode` upper-cased. */
const SUBDL_VARIETIES: Record<string, string> = { pob: 'BR_PT', zht: 'ZH_BG' }

export function subdlCode(code: string) {
  const c = shortCode(code)
  return SUBDL_VARIETIES[c] ?? c.toUpperCase()
}

/** Name → flag, built once per UI language rather than once per row. */
const FLAGS = new Map<string, Map<string, string>>()

/**
 * The flag beside a subtitle or audio language, out of `flags` — the language
 * picker's, keyed by UI locale, and the only pictures the bundle carries (see
 * `flags` in nuxt.config). Matched on the name a code resolves to, like every
 * other comparison here, so an mkv's "ger" and OpenSubtitles' "deu" get the
 * one flag; a language the app has no locale for gets none.
 */
export function langFlag(code: string, flags: Record<string, string>) {
  if (!code)
    return undefined
  const ui = globalThis.document?.documentElement.lang || 'en'
  let byName = FLAGS.get(ui)
  if (!byName) {
    byName = new Map(Object.entries(flags).map(([locale, icon]) => [langName(locale), icon]))
    FLAGS.set(ui, byName)
  }
  return byName.get(langName(VARIETY_OF[code.toLowerCase()] ?? code))
}

export interface SubtitleLanguage {
  code: string
  name: string
  /** Every file the addon has in this language, addon order (its best guess first). */
  files: Subtitle[]
}

/**
 * Words a subtitle file names its *kind* with, which ISO 639-3 also happens to
 * have a language for: "SDH" is Southern Kurdish and "HI" is Hindi, and both
 * turn up on English files every day of the week.
 */
const NOT_LANGUAGES = /^(?:sdh|hi|cc|forced)$/i

/**
 * A subtitle file that came inside the torrent, in the same shape the menu
 * lists a language in.
 *
 * Nothing labels these but their own path, so the name is both the label and
 * the only clue to the language. Everything the video file already says is
 * dropped — `Show.S01E07.1080p.WEB.eng.srt` next to `Show.S01E07.1080p.WEB.mkv`
 * is "English" and nothing else — a 2/3-letter tag that resolves to a language
 * is spelled out, and whatever is left is shown as it is: `2_English.srt` reads
 * better than "Track 4", and a name we can't make sense of is better shown
 * wrong than hidden.
 */
export function releaseSubtitle(path: string, video: string, url: string): SubtitleLanguage {
  const seen = new Set(video.toLowerCase().split(/[^a-z0-9]+/i))
  const file = path.split('/').pop() ?? ''
  const words = file
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z0-9]+/i)
    // The leading number in "2_English" is the muxer's index, not part of a name.
    .filter(w => w && !/^\d+$/.test(w) && !seen.has(w.toLowerCase()))

  const label = (w: string) => NOT_LANGUAGES.test(w) ? w : langName(w)
  const code = words.findLast(w => w.length <= 3 && label(w) !== w) ?? ''
  const name = words.map(label).join(' ') || $t('Subtitles')
  // The trimmed words are the menu's label; the file's own name is kept whole so
  // the row underneath can show what it actually is on disk.
  return { code, name, files: [{ id: url, url, lang: code, name: file }] }
}

/** One entry per language; the files inside it are told apart by `probe` below. */
export function byLanguage(list: Subtitle[]): SubtitleLanguage[] {
  const out = new Map<string, SubtitleLanguage>()
  for (const s of list) {
    const name = langName(s.lang)
    const seen = out.get(name)
    if (seen)
      seen.files.push(s)
    else
      out.set(name, { code: s.lang, name, files: [s] })
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Something to search subtitles by, for a playback that reached us without an
 * IMDb id — a bare magnet, or a title TMDB holds no external id for.
 *
 * TMDB first: it is the one metadata service the app has an actual agreement
 * with, and it settles the magnet case, where a filename is the only clue.
 *
 * But a TMDB record carrying no external id cannot be talked into producing
 * one — searching by name lands back on the same record and the same null — so
 * Cinemeta is the backstop for precisely what TMDB structurally can't answer.
 * It costs nothing new: the subtitle list itself already comes from the same
 * operator, so dropping it would shed no dependency, only answers.
 */
export async function findImdbId(title: string, series = false, year = ''): Promise<string> {
  if (!title.trim())
    return ''

  const known = await imdbIdByTitle(title, series, year)
  if (known)
    return known

  try {
    const url = `${CINEMETA}/catalog/${series ? 'series' : 'movie'}/top/search=${encodeURIComponent(title)}.json`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok)
      return ''

    const data = await res.json() as { metas?: { id?: string, name?: string, releaseInfo?: string }[] }
    // Cinemeta's catalogue search is fuzzy full-text and always answers with
    // *something* — for a mangled release name that something is routinely a
    // different film, and one wrong id here is a whole evening of subtitles for
    // the wrong movie. So the name it found has to be the name we asked for;
    // no match is a better answer than a confident wrong one.
    const hits = (data.metas ?? []).filter(m =>
      /^tt\d+$/.test(m.id ?? '') && plainTitle(m.name ?? '') === plainTitle(title))
    // Titles get remade; the year decides between "Dune" and "Dune".
    const hit = (year && hits.find(m => String(m.releaseInfo ?? '').startsWith(year))) || hits[0]
    return hit?.id ?? ''
  }
  catch {
    return '' // offline, or the addon is gone: the caller reports no match
  }
}

/** Punctuation, case and spacing are noise when two catalogues name one film. */
function plainTitle(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The name fields the addons that bother to name a file actually use. */
const NAME_KEYS = ['SubFileName', 'name', 'title', 'release', 'filename']

function toSubtitle(raw: Record<string, unknown>): Subtitle | null {
  if (typeof raw.url !== 'string' || !raw.url || typeof raw.lang !== 'string' || !raw.lang)
    return null
  const named = NAME_KEYS.map(k => raw[k]).find(v => typeof v === 'string' && v.trim())
  return {
    id: String(raw.id ?? raw.url),
    url: raw.url,
    lang: raw.lang,
    name: named ? String(named).trim() : undefined,
  }
}

async function subtitlesFrom(base: string, path: string): Promise<Subtitle[]> {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(20000) })
  if (!res.ok)
    throw new Error(`${base} answered HTTP ${res.status}`)

  const data = await res.json() as { subtitles?: Record<string, unknown>[] }
  return (data.subtitles ?? []).flatMap(s => toSubtitle(s) ?? [])
}

/** What the keyed providers search by besides an IMDb id, which they may not get at all. */
export interface SubtitleSearch {
  /** The user's own SubDL key — SubDL answers nothing without one. */
  subdl?: string
  /** The user's own SubSource key, likewise. */
  subsource?: string
  /** The app's OpenSubtitles key, from the build — see `searchOpenSubtitles`. */
  opensubtitles?: string
  /** The language to be sure of, past however many pages the rest come from. */
  lang?: string
  tmdbId?: number
  title?: string
  year?: string
}

/**
 * Pages of a keyed provider's answer to read. SubDL hands out thirty files a
 * page and a known film has hundreds, and every page is a request against a
 * limit — five is most languages for most films. The language the user reads
 * is asked for on its own besides, so it never depends on this.
 */
const PAGES = 5

type Page = (n: number, languages?: string) => Promise<{ subtitles: Subtitle[], pages: number }>

/**
 * The first page, the user's own language by itself besides (however far down
 * the rest it would have come), then up to `PAGES` of the rest. Only the first
 * page failing fails the provider.
 */
async function paged(page: Page, want: string) {
  const [first, mine] = await Promise.all([page(1), want ? page(1, want).catch(() => null) : null])
  const more = Array.from({ length: Math.min(first.pages, PAGES) - 1 }, (_, i) => page(i + 2).catch(() => null))
  return [...mine?.subtitles ?? [], ...first.subtitles, ...(await Promise.all(more)).flatMap(r => r?.subtitles ?? [])]
}

/**
 * Downloads left today, by provider, as each last said: SubSource on every
 * answer, OpenSubtitles on every download, SubDL on its account page at a
 * search. What a row that would spend one shows (`fileNote`), so picking a
 * file is never a guess about what it costs.
 */
export const quota = reactive<Record<string, number>>({})

/** Rust's fetch where there is one: for a provider that sends no CORS header, or wants a `User-Agent`. */
function http(): typeof fetch {
  return '__TAURI_INTERNALS__' in globalThis ? tauriFetch as typeof fetch : fetch
}

/**
 * One request, asked again once if a rate limit turned it away (429) — after
 * the wait it names, in seconds (`retry-after`) or as a time (SubSource's
 * `x-ratelimit-reset`), and never past a minute.
 */
async function patiently(ask: () => Promise<Response>): Promise<Response> {
  const res = await ask()
  if (res.status !== 429)
    return res
  const reset = Date.parse(res.headers.get('x-ratelimit-reset') ?? '')
  const wait = Number(res.headers.get('retry-after') ?? (reset ? (reset - Date.now()) / 1000 : 1))
  await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(wait, 0), 60) * 1000))
  return ask()
}

/**
 * One file of SubDL's listing, or null for one that isn't this episode.
 *
 * Its `language` is ISO 639-1 upper-cased, which `langName` reads once lowered —
 * so "SL" and OpenSubtitles' "slv" land in one row — except for the two
 * varieties, which are turned back into OpenSubtitles' codes for the same reason.
 */
function fromSubdl(raw: Record<string, unknown>, episode: number): Subtitle | null {
  const code = typeof raw.language === 'string' ? raw.language.toUpperCase() : ''
  if (typeof raw.url !== 'string' || !raw.url || !code)
    return null
  if (episode) {
    // A range is a pack of those episodes; no number at all is a whole season,
    // which `probe` searches for ours.
    const from = Number(raw.episode_from) || 0
    const end = Number(raw.episode_end) || 0
    const one = Number(raw.episode) || 0
    if (from && end && from !== end ? episode < from || episode > end : one && one !== episode)
      return null
  }
  const url = new URL(raw.url, SUBDL_FILES).href
  const named = [raw.release_name, raw.name].find(v => typeof v === 'string' && v.trim())
  return {
    id: url,
    url,
    lang: Object.keys(SUBDL_VARIETIES).find(k => SUBDL_VARIETIES[k] === code) ?? code.toLowerCase(),
    name: named ? String(named).trim() : undefined,
    metered: true,
    provider: 'SubDL',
    captions: raw.hi === true || undefined,
    episode: episode || undefined,
    download: () => subdlFile(url),
  }
}

/**
 * One archive off SubDL. The key is in its url, which is how SubDL counts it;
 * the count itself is only on its account page, so it is taken down by one here.
 */
async function subdlFile(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok)
    throw new Error(`SubDL answered HTTP ${res.status}`)
  if (quota.SubDL)
    quota.SubDL--
  return new Uint8Array(await res.arrayBuffer())
}

async function subdlPage(params: URLSearchParams, episode: number) {
  const res = await fetch(`${SUBDL}/subtitles?${params}`, { signal: AbortSignal.timeout(20000) })
  const data = await res.json().catch(() => ({})) as { error?: string, totalPages?: number, subtitles?: Record<string, unknown>[] }
  // A title it has nothing for is a 200 with `status: false` and "can't find"
  // — an answer, not a failure. A refused key is a 403.
  if (!res.ok)
    throw new Error(`SubDL answered HTTP ${res.status}${data.error ? ` — ${data.error}` : ''}`)
  return { subtitles: (data.subtitles ?? []).flatMap(s => fromSubdl(s, episode) ?? []), pages: data.totalPages ?? 1 }
}

/**
 * SubDL, with the user's key: the provider that answers with the depth the
 * built-in addon doesn't have, and with release names besides.
 *
 * It can search without an IMDb id, which is the other half of why it is here:
 * a TMDB id, or failing that a name and a year, for the bare magnet and the
 * title no catalogue links to IMDb. The IMDb id still wins when there is one,
 * because a name search is fuzzy on their side.
 */
async function searchSubdl(s: SubtitleSearch, imdbId: string, season: number, episode: number): Promise<Subtitle[]> {
  const params = new URLSearchParams({ api_key: s.subdl!, type: season ? 'tv' : 'movie', subs_per_page: '30' })
  if (imdbId) {
    params.set('imdb_id', imdbId)
  }
  else if (s.tmdbId) {
    params.set('tmdb_id', String(s.tmdbId))
  }
  else {
    // It refuses a name with an apostrophe in it outright, and indexes one as a
    // space: "Grey's" is found as "Grey s" and never as "Greys".
    params.set('film_name', (s.title ?? '').replace(/[<>{}[\]'"`´’;\\/]/g, ' ').replace(/\s+/g, ' ').trim())
    if (s.year)
      params.set('year', s.year)
  }
  if (season)
    params.set('season_number', String(season))
  if (episode)
    params.set('episode_number', String(episode))

  const page: Page = (n, languages = '') => {
    const p = new URLSearchParams(params)
    p.set('page', String(n))
    if (languages)
      p.set('languages', languages)
    return subdlPage(p, episode)
  }
  // What a download costs is on its account page, one call of the 2000.
  fetch(`${SUBDL}/me?api_key=${encodeURIComponent(s.subdl!)}`, { signal: AbortSignal.timeout(15000) })
    .then(res => res.json())
    .then((me: { apiAccount?: { downloads?: { remaining?: number } } }) => {
      const left = me.apiAccount?.downloads?.remaining
      if (typeof left === 'number')
        quota.SubDL = left
    })
    .catch(() => {})
  return paged(page, subdlCode(s.lang || globalThis.document?.documentElement.lang || ''))
}

/**
 * Does SubDL take this key? null when it couldn't be asked. `/me` is its account
 * page, so the answer costs no search.
 */
export async function subdlKeyWorks(key: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${SUBDL}/me?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })
    return res.ok || (res.status === 401 || res.status === 403 ? false : null)
  }
  catch {
    return null
  }
}

/**
 * OpenSubtitles' codes that aren't plain ISO 639-1, and the codes they are here
 * (its `/infos/languages`). Its Portuguese and Chinese always name the variety;
 * Spanish is both `es` and an invented `sp`, which the list showed as "sp".
 */
const OPENSUBTITLES_CODES: Record<string, string> = {
  'pt-br': 'pob',
  'pt-pt': 'pt',
  'pm': 'pt-MZ',
  'zh-cn': 'zh',
  'zh-tw': 'zht',
  'ze': 'zhe',
  'es': 'es',
  'sp': 'es',
  'ea': 'es-419',
  'me': 'cnr',
  'pr': 'prs',
  'at': 'ast',
  'ex': 'ext',
  'ma': 'mni',
  'sx': 'sat',
  'sy': 'syr',
  'tp': 'tok',
  'tm-td': 'tet',
}

/** What to ask OpenSubtitles for: every code of its own that is this language. */
function opensubtitlesCode(code: string) {
  const c = shortCode(code)
  const own = Object.keys(OPENSUBTITLES_CODES).filter(k => OPENSUBTITLES_CODES[k] === c)
  return own.length ? own.sort().join(',') : c
}

/** The fields of one result that are read here; there are thirty-odd more. */
interface OpenSubtitlesItem {
  attributes?: {
    language?: string
    release?: string
    url?: string
    hearing_impaired?: boolean
    foreign_parts_only?: boolean
    files?: { file_id?: number, file_name?: string }[]
  }
}

let agent: Promise<string> | undefined

/**
 * One request to OpenSubtitles' API. It wants the app named in `User-Agent` and
 * turns a generic one away — curl's, and plugin-http's own is as generic as they
 * come. A webview's `fetch` drops the header without a word, so it goes through
 * Rust wherever there is a Rust; a plain browser (`bun run dev`) sends its own.
 *
 * It takes five requests a second from an address and a search is six at once,
 * so the one turned away (429) is asked again when it says to — once.
 */
async function opensubtitles(path: string, key: string, body?: object): Promise<Response> {
  agent ??= getVersion().then(v => `Ventic v${v}`, () => 'Ventic')
  const headers: Record<string, string> = { 'Api-Key': key, 'Accept': 'application/json', 'User-Agent': await agent }
  if (body)
    headers['Content-Type'] = 'application/json'
  return patiently(() => http()(OPENSUBTITLES + path, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20000) }))
}

/**
 * One file off OpenSubtitles: a POST that is the download as far as the quota
 * is concerned, for a link good for a few hours, then the file itself — UTF-8
 * already, whatever it was uploaded as.
 *
 * Five a day is few enough to run out of, and that is a 406 whose `message`
 * says when the five come back — which is what the row and the OSD then show,
 * in OpenSubtitles' English, minus the stamp it ends with for its own logs.
 * An address behind carrier NAT or a VPN shares the five with strangers; a
 * login of the user's own (not built) would count against their account.
 */
async function opensubtitlesFile(id: number, key: string) {
  const res = await opensubtitles('/download', key, { file_id: id })
  const { link, message, remaining } = await res.json().catch(() => ({})) as { link?: string, message?: string, remaining?: number }
  if (typeof remaining === 'number')
    quota.OpenSubtitles = Math.max(remaining, 0)
  if (!link)
    throw new Error(message?.replace(/\s*ts=\d+\s*$/, '').replace(/\.(?=[A-Z])/g, '. ').trim() || `OpenSubtitles answered HTTP ${res.status}`)
  const file = await http()(link, { signal: AbortSignal.timeout(20000) })
  return new Uint8Array(await file.arrayBuffer())
}

/**
 * One result, or null for one that isn't worth listing: a file of only the
 * foreign-language parts (a film's signs and the odd line of Russian) is the
 * forced track — picked as a language's subtitles, it is a film with almost none.
 */
function fromOpenSubtitles(raw: OpenSubtitlesItem, key: string): Subtitle | null {
  const a = raw.attributes
  const file = a?.files?.[0]
  if (!a || !file?.file_id || !a.language || a.foreign_parts_only)
    return null
  const code = a.language.toLowerCase()
  const id = file.file_id
  return {
    id: `opensubtitles:${id}`,
    url: a.url || `${OPENSUBTITLES}/download#${id}`,
    lang: OPENSUBTITLES_CODES[code] ?? code,
    name: a.release?.trim() || file.file_name || undefined,
    metered: true,
    provider: 'OpenSubtitles',
    captions: a.hearing_impaired === true || undefined,
    download: () => opensubtitlesFile(id, key),
  }
}

/**
 * OpenSubtitles itself — the whole catalogue the built-in addon is a thin copy
 * of, release names included. Searching is free; reading a file is one of the
 * day's downloads, which is why `probeLanguage` lists them unread.
 *
 * It wants an IMDb id as a bare number, the parameters in alphabetical order
 * (any other order is answered with a redirect to that one — a second request
 * for nothing), and machine translations left out, which is its default; the
 * AI-translated ones it now holds in bulk are left out too, as Bazarr does.
 */
async function searchOpenSubtitles(s: SubtitleSearch, imdbId: string, season: number, episode: number): Promise<Subtitle[]> {
  const key = s.opensubtitles!
  const params = new URLSearchParams({ ai_translated: 'exclude' })
  if (imdbId) {
    params.set(season ? 'parent_imdb_id' : 'imdb_id', String(Number(imdbId.replace(/^tt/i, ''))))
  }
  else if (s.tmdbId) {
    params.set(season ? 'parent_tmdb_id' : 'tmdb_id', String(s.tmdbId))
  }
  else {
    params.set('query', (s.title ?? '').toLowerCase())
    if (s.year)
      params.set('year', s.year)
  }
  if (season) {
    params.set('season_number', String(season))
    params.set('episode_number', String(episode))
  }

  const page: Page = async (n, languages = '') => {
    const p = new URLSearchParams(params)
    p.set('page', String(n))
    if (languages)
      p.set('languages', languages)
    p.sort()
    const res = await opensubtitles(`/subtitles?${p}`, key)
    const data = await res.json().catch(() => ({})) as { total_pages?: number, data?: OpenSubtitlesItem[], message?: string }
    if (!res.ok)
      throw new Error(`OpenSubtitles answered HTTP ${res.status}${data.message ? ` — ${data.message}` : ''}`)
    return { subtitles: (data.data ?? []).flatMap(r => fromOpenSubtitles(r, key) ?? []), pages: data.total_pages ?? 1 }
  }
  return paged(page, opensubtitlesCode(s.lang || globalThis.document?.documentElement.lang || ''))
}

/**
 * SubSource names a language in English, lower-cased and with underscores —
 * `slovenian`, `brazilian_portuguese` — which `Intl` reads back for every one
 * but these: the ones it spells its own way, and one it misspells.
 */
const SUBSOURCE_NAMES: Record<string, string> = {
  farsi_persian: 'fa',
  brazilian_portuguese: 'pob',
  chinese_bg_code: 'zh',
  bengali: 'bn',
  espranto: 'eo',
  northen_sami: 'se',
  gaelic: 'gd',
  pushto: 'ps',
}

let englishNames: Map<string, string> | undefined

/** `slovenian` -> `sl`: every two-letter code's English name, read backwards. */
function fromSubsourceName(name: string) {
  const n = name.toLowerCase().replace(/ /g, '_')
  if (SUBSOURCE_NAMES[n])
    return SUBSOURCE_NAMES[n]
  if (!englishNames) {
    const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })
    const letters = 'abcdefghijklmnopqrstuvwxyz'
    englishNames = new Map([...letters].flatMap(a => [...letters].flatMap(b => {
      const said = names.of(a + b)
      return said ? [[said.toLowerCase().replace(/ /g, '_'), a + b] as const] : []
    })))
  }
  return englishNames.get(n) ?? n
}

/** `sl` (or `slv`, or `pob`) -> the name SubSource files it under. */
export function subsourceName(code: string) {
  const c = shortCode(code)
  const own = Object.keys(SUBSOURCE_NAMES).find(k => SUBSOURCE_NAMES[k] === c)
  if (own || !c)
    return own ?? ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(c)?.toLowerCase().replace(/ /g, '_') ?? ''
  }
  catch {
    return ''
  }
}

/** The fields of one result that are read here. */
interface SubSourceItem {
  subtitleId?: number
  language?: string
  releaseInfo?: string[]
  hearingImpaired?: boolean
  foreignParts?: boolean
  link?: string
}

/**
 * One request to SubSource, through Rust: it answers a browser's preflight but
 * not the request after it. Every answer says how many of the key's 7200 a day
 * are left, which is the whole of what `quota` needs from it.
 */
async function subsource(path: string, key: string) {
  const res = await patiently(() => http()(`${SUBSOURCE}/${path}`, { headers: { 'X-API-Key': key, 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) }))
  const left = res.headers.get('x-ratelimit-remaining-day')
  if (left)
    quota.SubSource = Number(left)
  return res
}

async function subsourceJson<T>(path: string, key: string): Promise<T> {
  const res = await subsource(path, key)
  const data = await res.json().catch(() => ({})) as T & { message?: string }
  // A refused key is a 401 that says so: "The provided API key is invalid or inactive".
  if (!res.ok)
    throw new Error(`SubSource answered HTTP ${res.status}${data.message ? ` — ${data.message}` : ''}`)
  return data
}

/** One archive off SubSource — an ordinary request as far as its limit is concerned. */
async function subsourceFile(id: number, key: string) {
  const res = await subsource(`subtitles/${id}/download`, key)
  if (!res.ok)
    throw new Error(`SubSource answered HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * One result, or null for another episode's or the forced track's. A show is
 * one entry a season there, and its episode filter is ignored (41 of 41 either
 * way, measured 2026-11-01), so the release name is what says which episode a
 * file is for — and one that names none is the season in one archive, which
 * `unzip` takes ours out of.
 */
function fromSubsource(raw: SubSourceItem, key: string, season: number, episode: number): Subtitle | null {
  const id = raw.subtitleId
  if (!id || !raw.language || raw.foreignParts)
    return null
  const name = raw.releaseInfo?.find(r => r.trim())?.trim()
  if (episode) {
    const said = parseRelease(name ?? '')
    if ((said.episode && said.episode !== episode) || (said.season && said.season !== season))
      return null
  }
  return {
    id: `subsource:${id}`,
    url: raw.link ? `https://subsource.net${raw.link}` : `${SUBSOURCE}/subtitles/${id}`,
    lang: fromSubsourceName(raw.language),
    name,
    metered: true,
    provider: 'SubSource',
    captions: raw.hearingImpaired === true || undefined,
    episode: episode || undefined,
    download: () => subsourceFile(id, key),
  }
}

/**
 * SubSource, with the user's key — Subscene's catalogue, and the one keyed
 * provider whose limit is a rate rather than a ration: 7200 requests a key a
 * day, a download being one of them. That is what an offline season leans on.
 *
 * Two steps: its own id for the title (a show's is one a season), by IMDb id or
 * else by name and year, and then the files.
 */
async function searchSubSource(s: SubtitleSearch, imdbId: string, season: number, episode: number): Promise<Subtitle[]> {
  const key = s.subsource!
  const find = new URLSearchParams(imdbId ? { searchType: 'imdb', imdb: imdbId } : { searchType: 'text', q: (s.title ?? '').toLowerCase() })
  if (season)
    find.set('season', String(season))
  const { data: titles = [] } = await subsourceJson<{ data?: { movieId?: number, releaseYear?: number, season?: number | null }[] }>(`movies/search?${find}`, key)
  // A name search answers with everything that shares the words.
  const hit = titles.find(t => (!season || t.season === season) && (imdbId || !s.year || String(t.releaseYear) === s.year))
  if (!hit?.movieId)
    return []

  const page: Page = async (n, language = '') => {
    const p = new URLSearchParams({ movieId: String(hit.movieId), limit: '100', page: String(n) })
    if (language)
      p.set('language', language)
    const { data = [], pagination } = await subsourceJson<{ data?: SubSourceItem[], pagination?: { pages?: number } }>(`subtitles?${p}`, key)
    return { subtitles: data.flatMap(r => fromSubsource(r, key, season, episode) ?? []), pages: pagination?.pages ?? 1 }
  }
  return paged(page, subsourceName(s.lang || globalThis.document?.documentElement.lang || ''))
}

/** Does SubSource take this key? null when it couldn't be asked. Costs one of the 7200. */
export async function subsourceKeyWorks(key: string): Promise<boolean | null> {
  try {
    const res = await subsource('movies/search?searchType=imdb&imdb=tt0241527', key)
    return res.ok || (res.status === 401 || res.status === 403 ? false : null)
  }
  catch {
    return null
  }
}

/**
 * Every subtitle for a movie, or for one episode of a show.
 *
 * The built-in addon is asked, and so is every source the user configured: one
 * addon base answers `/stream/` and `/subtitles/` off the same URL, so a source
 * that also does subtitles is already in the list and costs one request. Most
 * don't and 404, which is why a failure is only fatal when they all fail — the
 * same rule `findReleases` searches under. OpenSubtitles' own API, SubSource and
 * SubDL are three more when there is a key for them, and the only ones asked
 * when there is no IMDb id at all.
 *
 * `filename` is Stremio's own extra and is what a provider matches a *cut* by
 * rather than just a title. The built-in addon ignores it (it matches on the
 * IMDb id alone, which is the whole reason a list of forty files for one film
 * contains so many that were never cut for the copy being played) — the ones
 * that honour it hand back something already in sync.
 */
export async function findSubtitles(imdbId: string, season = 0, episode = 0, filename = '', by: SubtitleSearch = {}): Promise<Subtitle[]> {
  const series = season > 0 && episode > 0
  const id = series ? `${imdbId}:${season}:${episode}` : imdbId
  const extra = filename ? `/filename=${encodeURIComponent(filename)}` : ''
  const path = `/subtitles/${series ? 'series' : 'movie'}/${id}${extra}.json`

  const bases = imdbId ? [ADDON, ...configuredSources().filter(b => b !== ADDON)] : []
  const asks = bases.map(b => subtitlesFrom(b, path))
  if (by.opensubtitles)
    asks.push(searchOpenSubtitles(by, imdbId, series ? season : 0, series ? episode : 0))
  if (by.subsource)
    asks.push(searchSubSource(by, imdbId, series ? season : 0, series ? episode : 0))
  if (by.subdl)
    asks.push(searchSubdl(by, imdbId, series ? season : 0, series ? episode : 0))
  const results = await Promise.allSettled(asks)
  const failed = results.flatMap(r => r.status === 'rejected' ? [String(r.reason)] : [])
  if (results.length && failed.length === results.length)
    throw new Error($t('Subtitle search failed — {reason}', { reason: failed[0]! }))

  // Two addons fronting the same OpenSubtitles mirror hand back the same file
  // twice; the first base wins, so a named copy from a source outranks the
  // built-in addon's anonymous one only if it got there first.
  const seen = new Map<string, Subtitle>()
  for (const s of results.flatMap(r => r.status === 'fulfilled' ? r.value : [])) {
    const had = seen.get(s.url)
    if (!had)
      seen.set(s.url, s)
    else if (!had.name && s.name)
      seen.set(s.url, { ...had, name: s.name })
  }
  // Within a language this is the order files are tried in, and a release name
  // sharing more words with the file playing — the group, the source, the
  // resolution — was more likely timed to it. A file with no name keeps its place.
  const words = new Set(filename.toLowerCase().split(/[^a-z0-9]+/))
  const shared = (s: Subtitle) => [...new Set(s.name?.toLowerCase().split(/[^a-z0-9]+/))].filter(w => w && words.has(w)).length
  return [...seen.values()].sort((a, b) => shared(b) - shared(a))
}

// ---------------------------------------------------------------------------
// Reading the files themselves
//
// The addon's entries carry nothing but a url and a language, so the only way
// to tell five English files apart — or to line one up with the audio — is to
// download it and look. They're ~100 KB of text and Cloudflare-cached.
// ---------------------------------------------------------------------------

export interface Cue {
  start: number
  end: number
  text: string
}

function toSeconds(stamp: string) {
  const [h = '0', m = '0', s = '0'] = stamp.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number.parseFloat(s.replace(',', '.'))
}

/**
 * Markup a line carries for a renderer rather than for the reader: SubRip's
 * `<i>`/`<b>`/`<font>`, WebVTT's `<v Speaker>` and inline timestamps, and the
 * ASS override blocks (`{\an8}`) both formats smuggle.
 *
 * mpv draws these. Every other backend gets the text drawn as plain DOM by the
 * page, where an `<i>` would show up as three literal characters — which is what
 * it did on Android and on the TV. Matching wants them gone too: a leading `<i>`
 * hides the bracket `CAPTION_LINE` looks for.
 */
function stripMarkup(line: string) {
  return line.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim()
}

/**
 * SubRip and WebVTT both hang everything off the `-->` line, and that's all this
 * needs, so one parser covers the pair.
 *
 * ASS/SSA files (a minority on OpenSubtitles) parse to zero cues and
 * are reported as unreadable rather than mis-parsed — mpv still plays them, they
 * just can't be labelled or auto-synced.
 */
export function parseCues(text: string): Cue[] {
  const out: Cue[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i]!.indexOf('-->')
    if (at < 0)
      continue
    const start = toSeconds(lines[i]!.slice(0, at).trim())
    const end = toSeconds(lines[i]!.slice(at + 3).trim().split(/\s/)[0] ?? '')
    if (!Number.isFinite(start) || !Number.isFinite(end))
      continue
    const body: string[] = []
    // A blank line ends the cue, so the loop still tests the raw line — a line
    // that was nothing but markup drops out instead of leaving an empty row.
    while (++i < lines.length && lines[i]!.trim()) {
      const line = stripMarkup(lines[i]!)
      if (line)
        body.push(line)
    }
    out.push({ start, end, text: body.join('\n') })
  }
  return out
}

/** "(electricity buzzing)", "- [door creaks]", "MAN:" — described sound, not dialogue. */
const CAPTION_LINE = /^-?\s*(?:[[(][^\])]*[\])]\s*[.,!?]?$|[A-Z][A-Z0-9 .'#-]{2,}:)/

/**
 * A speaker label at the head of a line: "MAN:", "NARRATOR:", "DR. WALLACE:".
 * Upper case only, and the same shape `CAPTION_LINE` looks for — a label that
 * reads like a sentence isn't one. "I told him: go home" has to survive this.
 */
const SPEAKER = /^(-?\s*)[A-Z][A-Z0-9 .'#-]{2,}:\s*/
/** A described sound anywhere in the line: "(door creaks)", "[thunder]". */
const ENCLOSED = /[[(][^\])]*[\])]/g

/**
 * The same text with the hearing-impaired additions taken out, and lines that
 * were nothing else dropped entirely.
 *
 * For the `<video>` and ExoPlayer paths, where the page draws the cues itself;
 * mpv does its own with `sub-filter-sdh`, and this matches what that does.
 */
export function stripCaptions(text: string) {
  const lines = text.split('\n')
  const kept = lines
    .map(line => line
      .replace(SPEAKER, '$1')
      .replace(ENCLOSED, '')
      .replace(/\s{2,}/g, ' ')
      .trim())
    // A lone "-" is the dialogue dash of a line that has just gone away.
    .filter(l => l && l !== '-')

  // That dash marks one speaker of two. Once the other one has been dropped it
  // marks nothing, so "- [door creaks] / - Run." ends up as plain "Run." — but
  // a cue that always was one dashed line keeps it, since there it means the
  // line before.
  return (kept.length === 1 && kept.length < lines.length
    ? [kept[0]!.replace(/^-\s*/, '')]
    : kept).join('\n')
}

/**
 * Is this the hearing-impaired cut? A handful of stray brackets is normal
 * (song lyrics, a translated sign), so it takes both a real count and a real
 * share of the file — the SDH releases sit around 10% and the plain ones at 0.
 */
export function isCaptions(cues: Cue[]) {
  const marked = cues.filter(c => c.text.split('\n').some(l => CAPTION_LINE.test(l))).length
  return marked > 8 && marked * 50 > cues.length
}

export interface SubtitleFile extends Subtitle {
  cues: Cue[]
  /** Hearing-impaired: every noise spelled out in brackets. */
  captions: boolean
  /** The file as text: what mpv gets for a metered one (`mpvSource`), and what a cast hands over. */
  text?: string
  /** Listed on the provider's word alone: it costs a download to read, so it is read when played. */
  unread?: boolean
  /** Why it wouldn't download, where the provider said — a spent quota says when it renews. */
  error?: string
}

/**
 * Read once and kept, by url — the same file is re-read on every sync. A
 * season's archive is one url for every episode in it, so a copy is only this
 * file's if its episode is too (`already`).
 */
const files = new Map<string, SubtitleFile>()
/**
 * And asked for once, by `fileKey`: on a pick, mpv's copy and the cues' copy are
 * wanted at the same moment, and with a quota counting downloads the second one
 * was a whole one.
 */
const reading = new Map<string, Promise<SubtitleFile>>()

/**
 * Which file this is, wherever it is kept: its url without the query (SubDL's
 * carries the user's key), and the episode — see `files`.
 */
function fileKey(s: Subtitle) {
  return s.url.split('?')[0] + (s.episode ? `#${s.episode}` : '')
}

/** This launch's read copy of the file, if there is one. */
function already(s: Subtitle) {
  const f = files.get(s.url)
  return f?.episode === s.episode ? f : undefined
}

/**
 * A metered file read on any launch — see utils/shelf. Reopening a film, or
 * going back to an episode, must not spend a second download on subtitles it
 * already had.
 */
function onShelf(s: Subtitle) {
  return shelved<string>('files', fileKey(s))
}

/**
 * The file chosen for one film or episode, by its progress key: put back with
 * no search the next time it plays, and the only subtitles there are with no
 * network. Written at every pick and by an offline download (see utils/offline).
 */
export interface KeptSubtitle {
  lang: string
  name?: string
  text: string
}

export function keptSubtitle(key: string) {
  return shelved<KeptSubtitle>('chosen', key)
}

export function keepSubtitle(key: string, f: SubtitleFile) {
  if (key && f.text && f.cues.length)
    return shelve('chosen', key, { lang: f.lang, name: f.name, text: f.text } satisfies KeptSubtitle)
}

const SUBTITLE_FILE = /\.(?:srt|vtt|ass|ssa|sub)$/i

/**
 * The subtitle inside a ZIP, inflated — null when there isn't one to be sure of.
 *
 * Read through the central directory, because a zip written as a stream leaves
 * the sizes out of the header in front of each file. An archive of a whole
 * season gives up only the file that names `episode`: any other one would fit
 * the runtime as well as the right one does, so it would be offered as a match.
 */
async function unzip(zip: Uint8Array, episode = 0): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  // The directory's own record closes the file, behind a comment of up to 64 KiB.
  let end = zip.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054B50)
    end--
  if (end < 0)
    return null

  const entries: { name: string, method: number, size: number, at: number }[] = []
  for (let i = 0, p = view.getUint32(end + 16, true); i < view.getUint16(end + 10, true); i++) {
    const length = view.getUint16(p + 28, true)
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + length))
    // macOS packs a `._name.srt` of binary metadata beside every file it zips.
    if (SUBTITLE_FILE.test(name) && !/(?:^|\/)(?:__MACOSX\/|\._)/.test(name))
      entries.push({ name, method: view.getUint16(p + 10, true), size: view.getUint32(p + 20, true), at: view.getUint32(p + 42, true) })
    p += 46 + length + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
  }
  // A lone file that names another episode isn't ours either: a release name
  // that read as a season pack was sometimes one episode's archive.
  const e = episode ? entries.find(f => parseRelease(f.name).episode === episode) ?? (entries.length === 1 && !parseRelease(entries[0]!.name).episode ? entries[0] : undefined) : entries[0]
  if (!e)
    return null

  // The header in front of the data repeats the name and has an extra field of
  // its own, which need not be the directory's length.
  const start = e.at + 30 + view.getUint16(e.at + 26, true) + view.getUint16(e.at + 28, true)
  const data = zip.slice(start, start + e.size)
  if (e.method === 0)
    return data
  if (e.method !== 8)
    return null
  const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

/**
 * The codepage a file in this language was most likely saved in, when it isn't
 * UTF-8. The addon re-encodes everything it serves, but SubDL and a release's
 * own files arrive as they were written — a Slovenian file from 2005 is
 * Windows-1250, and read as UTF-8 every č in it is a box. mpv guesses for
 * itself; the page, which draws the cues on Android, has only this.
 */
const CODEPAGES: Record<string, string> = {
  ...Object.fromEntries(['sl', 'hr', 'bs', 'sr', 'cs', 'sk', 'pl', 'hu', 'ro'].map(c => [c, 'windows-1250'])),
  ...Object.fromEntries(['ru', 'uk', 'bg', 'mk', 'be'].map(c => [c, 'windows-1251'])),
  el: 'windows-1253',
  tr: 'windows-1254',
  he: 'windows-1255',
  ar: 'windows-1256',
  fa: 'windows-1256',
  ...Object.fromEntries(['et', 'lv', 'lt'].map(c => [c, 'windows-1257'])),
  vi: 'windows-1258',
  th: 'windows-874',
  zh: 'gb18030',
  zht: 'big5',
  ja: 'shift_jis',
  ko: 'euc-kr',
}

export function decodeSubtitle(bytes: Uint8Array, lang: string) {
  // UTF-16 has no other tell than its byte order mark.
  if (bytes[0] === 0xFF && bytes[1] === 0xFE)
    return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xFE && bytes[1] === 0xFF)
    return new TextDecoder('utf-16be').decode(bytes)
  // Read as UTF-8, a legacy file breaks on nearly every accented letter, and a
  // UTF-8 file with one stray byte breaks once among hundreds that read fine —
  // which used to show as one � and must not turn the rest into mojibake.
  const utf8 = new TextDecoder().decode(bytes)
  const broken = utf8.split('\uFFFD').length - 1
  if (broken * 20 <= (utf8.match(/[^\p{ASCII}\uFFFD]/gu)?.length ?? 0))
    return utf8
  return new TextDecoder(CODEPAGES[shortCode(lang)] ?? 'windows-1252').decode(bytes)
}

export function probe(s: Subtitle): Promise<SubtitleFile> {
  const key = fileKey(s)
  let p = reading.get(key)
  if (!p) {
    p = read(s)
    reading.set(key, p)
    // One that didn't read is asked again at the next pick: a refused download
    // costs nothing, and a TV is left on past the midnight its quota renews at.
    p.then(f => {
      if (!f.cues.length)
        reading.delete(key)
    })
  }
  return p
}

async function read(s: Subtitle): Promise<SubtitleFile> {
  // A metered file read on an earlier launch costs nothing now.
  const kept = s.metered ? await onShelf(s) : undefined
  let text = kept ?? ''
  let error: string | undefined
  if (kept === undefined) {
    try {
      let bytes: Uint8Array
      if (s.download) {
        bytes = await s.download()
      }
      else {
        // A release's own file on a cast mirror is another device on the LAN,
        // so it goes through Rust for the reason `torrentDetails` gives.
        const get = mirrored(s.url) && '__TAURI_INTERNALS__' in globalThis ? tauriFetch : fetch
        const res = await get(s.url, { signal: AbortSignal.timeout(20000) })
        bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array()
      }
      // By its signature rather than by provider: SubDL serves the odd file bare.
      if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
        bytes = await unzip(bytes, s.episode) ?? new Uint8Array()
      }
      text = decodeSubtitle(bytes, s.lang)
    }
    catch (e) {
      // Offline, a dead mirror or a broken archive: it lists as unreadable and
      // mpv can still try it. A provider's own refusal is worth its words.
      if (s.download && e instanceof Error)
        error = e.message
    }
  }
  const cues = parseCues(text)
  if (s.metered && kept === undefined && cues.length)
    shelve('files', fileKey(s), text)
  // What gets picked is often the unread row itself, which this now replaces.
  const file: SubtitleFile = { ...s, cues, captions: isCaptions(cues), text: text || undefined, unread: undefined, error }
  files.set(s.url, file)
  return file
}

/**
 * What mpv is given to open: the url, which it reads itself — or, for a metered
 * file, the text we already read, through mpv's own `memory://` protocol. Its
 * url is a ZIP mpv can't open over http or a page, and fetching it again would
 * be a second download besides. Its `track-list` then carries the whole file
 * as the track's name, which only matters because that list is read on a pick
 * and a menu open and not on every frame.
 */
export async function mpvSource(s: Subtitle) {
  // Only a url anybody can fetch: not one that costs a download, nor one that
  // exists only here (a file a cast brought — see `download`).
  if (!s.metered && !s.download)
    return s.url
  const { text } = await probe(s)
  return text ? `memory://${text}` : s.url
}

/** Cached-only lookup, for code that can't wait on the network. */
export function probed(url: string) {
  return files.get(url)
}

/**
 * Every line showing at `t` seconds, for the `<video>` path where the page
 * draws the subtitles rather than mpv. Two speakers overlap often enough that
 * this joins them instead of picking one, which is what mpv does too.
 *
 * A linear scan per frame. A film is ~1500 cues, so this is tens of
 * microseconds — index them by second if a 40 000-cue karaoke file ever shows up.
 */
export function cueAt(cues: Cue[], t: number) {
  return cues.filter(c => t >= c.start && t < c.end).map(c => c.text).join('\n')
}

/** Where the last line lands — near enough the runtime the file was cut for. */
export function subRuntime(f: { cues: Cue[] }) {
  return f.cues.length ? f.cues[f.cues.length - 1]!.end : 0
}

/**
 * Could this file be for the video that is playing at all?
 *
 * This is the answer to subtitles that are not late or early but *unrelated*.
 * The addon matches on the IMDb id and nothing else, so a list for one film also
 * holds files cut for the extended edition, for a different episode of the same
 * show, and — once a bare magnet has been matched to the wrong title — for a
 * different film entirely. All of those stop minutes away from where this video
 * does, and the cues are already downloaded, so the check is free.
 *
 * The window is wide on purpose. A film's last line lands well before the end
 * credits, and a file authored for another framerate runs ~4% long or short and
 * is worth keeping because `sub-speed` fixes it. Nothing is ever hidden by
 * this — a bad fit sorts last and says so, since a file that fails the test is
 * still better than the no subtitles you'd have without it.
 */
export function fitsRuntime(f: { cues: Cue[] }, duration: number) {
  const end = subRuntime(f)
  if (!duration || !end)
    return true // an unreadable file, or a video whose length we don't know yet
  return end > duration * 0.7 && end < duration * 1.08 + 60
}

/**
 * What to call one file. A provider that named it wins — a release name is the
 * only label that says which encode a file was cut for. The built-in addon
 * names none, so the fallback describes what is actually in the file instead of
 * numbering it.
 */
export function fileLabel(f: SubtitleFile) {
  if (f.name)
    return f.name
  if (!f.cues.length)
    return $t('Unreadable')
  return f.captions ? $t('Captions (SDH)') : $t('Dialogue only')
}

/** The dim second line: the facts that tell two files of one language apart. */
export function fileNote(f: SubtitleFile) {
  // Unread, a file has only its provider's word to go on — and what picking it
  // costs, which is the one thing worth knowing before the pick.
  if (f.unread) {
    const left = quota[f.provider ?? '']
    return [f.provider, left === undefined ? '' : $t('{count} left today', { count: left }), f.captions ? $t('SDH') : ''].filter(Boolean).join(' · ')
  }
  if (!f.cues.length)
    return f.error ?? $t('Unreadable')
  return [
    // Already said by the label when there is no name to show instead.
    f.name && f.captions ? $t('SDH') : '',
    runtimeText(Math.round(subRuntime(f) / 60)),
    $t('{count} lines', { count: f.cues.length }),
  ].filter(Boolean).join(' · ')
}

/**
 * The files of one language, best first: one that covers this video's runtime
 * over one that plainly doesn't; then one that is free, or was read already,
 * over one that would spend a download (below); then plain dialogue over the
 * hearing-impaired cut — the addon's own order puts that on top often enough
 * that it can't be trusted as a default, and `hideCaptions` strips it anyway.
 * Unreadable ones sink to the bottom.
 *
 * `duration` is the video's, in seconds; 0 where it isn't known yet, which just
 * leaves the fit out of the ordering. The limit is what bounds the cost: each
 * file is ~100 KB of Cloudflare-cached text, fetched in parallel, and a dozen
 * is enough to find a good one without pulling bandwidth off the download.
 *
 * Metered files aren't read here unless they were before. A language of a
 * known film is twenty of them on SubDL and as many again on OpenSubtitles,
 * every one read is one of a day's downloads, and a dozen read per language
 * picked spent SubDL's 50 in four films. So they are listed on their release
 * names, closest to the file playing first (`findSubtitles`), and only ever
 * chosen when nothing free fits — what "choose automatically" picks is what it
 * picked before there were any. The one picked is the one downloaded, and kept
 * (`onShelf`), so coming back to it is free. Of two that would cost, the one
 * with the most to spare goes first: SubSource's 7200 a day, then SubDL's 50 —
 * both the user's own — and OpenSubtitles' 5 a household last (`SCARCITY`).
 */
const SCARCITY: Record<string, number> = { SubSource: 0, SubDL: 1, OpenSubtitles: 2 }

export async function probeLanguage(lang: SubtitleLanguage, duration = 0, limit = 12): Promise<SubtitleFile[]> {
  const free = lang.files.filter(f => !f.metered).slice(0, limit).map(probe)
  const metered = lang.files.filter(f => f.metered).map(async f =>
    already(f) ?? (await onShelf(f) !== undefined ? probe(f) : { ...f, cues: [], captions: !!f.captions, unread: true }))
  const dead = (f: SubtitleFile) => !f.cues.length && !f.unread
  const scarce = (f: SubtitleFile) => f.unread ? SCARCITY[f.provider ?? ''] ?? 0 : 0
  return (await Promise.all([...free, ...metered])).sort((a, b) =>
    Number(dead(a)) - Number(dead(b))
    || Number(fitsRuntime(b, duration)) - Number(fitsRuntime(a, duration))
    || Number(!!a.unread) - Number(!!b.unread)
    || scarce(a) - scarce(b)
    || Number(a.captions) - Number(b.captions))
}

// ---------------------------------------------------------------------------
// Auto-sync
// ---------------------------------------------------------------------------

/**
 * Seconds per reading of the audio envelope. Set by `ENVELOPE_BIN` on the Rust
 * side, which is what actually decides it — this only has to agree.
 */
const BIN = 0.2

/**
 * Playback rates a subtitle file gets authored against. Almost every timing that
 * drifts rather than sits at a fixed offset is one transfer meeting another:
 * 25 fps PAL against 23.976 film is 4.3%, which is two and a half minutes by the
 * end of a feature, and 24 against 23.976 is the 0.1% of NTSC pulldown.
 *
 * Straight into mpv's `sub-speed`, which multiplies cue timestamps — so these
 * are ratios and not fps, and 1 (leave it alone) has to be tried like the rest.
 * It goes first: the tie-break below hands a close call to changing nothing.
 */
const RATES = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24]

/**
 * Shortest window worth a verdict. Under this the fit has enough freedom to land
 * somewhere confidently wrong: a two-minute window will happily "find" a 75 s
 * shift and score it well.
 */
export const SYNC_MIN_WINDOW = 300

/**
 * And the shortest that can measure a rate error rather than guess one. A rate
 * error shows inside the window as a stretch, and 0.1% of five minutes is a
 * third of a second — under the slop of the fit, so a short window would pick
 * a rate off noise and hand the whole film a drift it didn't have. A shift
 * found at the wrong rate is at least right where it was measured, which is
 * where the film is being watched.
 */
const RATE_MIN_WINDOW = 600

/** Shifts this close to the winner are the same answer, not a rival one. */
const PEAK_GUARD = 3

/**
 * How much better a rate has to fit before changing it is worth it. Two of
 * `RATES` are a tenth of a percent apart and fit each other's films almost as
 * well, so without a margin the winner is a coin toss — and the rate that
 * leaves the file alone should win a coin toss.
 */
const RATE_MARGIN = 0.02

export interface Sync {
  /** Seconds to shift by — straight into mpv's `sub-delay`. */
  offset: number
  /** Timestamp multiplier for `sub-speed`; 1 unless the file was cut for another rate. */
  speed: number
  /** Correlation at the winning fit, -1 to 1. */
  score: number
  /** How far that peak stands above the rest of the curve, in standard deviations. */
  confidence: number
}

/**
 * Is this fit worth applying, or should the caller say it couldn't tell?
 *
 * A correlation means nothing on its own — how high it runs depends on how
 * talky the film is. What separates an answer from a coincidence is how far the
 * peak stands out of its own curve, so the test is a z-score against every other
 * shift that was tried. Dialogue is repetitive and a whole scene can line up
 * against the wrong one, but it can't do so five deviations better than
 * everything else. The floor underneath rules out a stretch with no dialogue in
 * it at all, where the curve is flat enough for noise to score well.
 */
export function synced(fit: Sync) {
  return fit.score >= 0.1 && fit.confidence >= 5
}

/**
 * How quiet the film gets around each bin, in dB.
 *
 * Levels wander across twenty minutes — a reel change, a scene under music, an
 * old transfer that was never mastered evenly — and dialogue in the loud part
 * is quieter than the room tone in another. Sampling the low end of each half
 * minute and sliding between those marks gives every bin a local zero to be
 * measured against, so the cut below is one decision for the window rather than
 * one per scene.
 */
function quietFloor(envelope: Float32Array): Float32Array {
  const block = Math.round(30 / BIN)
  const marks: number[] = []
  for (let i = 0; i < envelope.length; i += block) {
    const chunk = Array.from(envelope.slice(i, i + block)).sort((a, b) => a - b)
    marks.push(chunk[Math.floor(chunk.length * 0.2)] ?? chunk[0] ?? 0)
  }

  const floor = new Float32Array(envelope.length)
  for (let i = 0; i < envelope.length; i++) {
    // Marks sit at block centres; before the first and after the last there is
    // nothing to slide towards, so they hold.
    const x = Math.max(0, Math.min(marks.length - 1, (i - block / 2) / block))
    const a = Math.floor(x)
    const b = Math.min(marks.length - 1, a + 1)
    floor[i] = marks[a]! + (marks[b]! - marks[a]!) * (x - a)
  }
  return floor
}

/**
 * How much is being said in each bin, 0 to 1.
 *
 * The level itself can't be used as it stands: a subtitle file knows when
 * someone speaks and nothing whatever about how loud the film is while they do,
 * so correlating against loudness matched the two on the one thing they don't
 * share — a score sting or a door slam outranks a spoken line, and on a scored
 * film the cues drift towards the music. Measured against the local floor and
 * flattened at the top, what is left is where the film is louder than the room
 * it is in, which is a shape a subtitle file does have.
 *
 * Flattened at the *film's* own top, not a fixed number of decibels: a 1968
 * optical mono print has maybe six decibels between the hiss and a shout, a
 * modern mix has fifty, and a constant that suits one calls the other silent.
 * The loudest fiftieth of the window is full scale and everything else is read
 * against that, so both come out with the same contrast to fit against — a
 * fiftieth rather than a tenth because a window can easily be nine tenths
 * silence, and then a tenth is silence too.
 *
 * The floor under it is the one number that has to be a number: a stretch whose
 * loudest moment is under three decibels over its own room tone has no dialogue
 * in it to find, and without the guard it would be normalised into a full-scale
 * mask made of nothing but hiss.
 */
function heard(envelope: Float32Array): Float32Array {
  const floor = quietFloor(envelope)
  const over = Float32Array.from(envelope, (v, i) => v - floor[i]!)

  const ranked = Array.from(over).sort((a, b) => b - a)
  const top = Math.max(3, ranked[Math.floor(ranked.length * 0.02)]!)
  return Float32Array.from(over, v => Math.min(1, Math.max(0, v / top)))
}

/**
 * Pearson correlation between the cues and the audio at every shift in ±`steps`
 * bins,
 * one reading per bin. `sub[i]` against `audio[i + k]` — so a positive k is the
 * cues arriving before the sound, which is a positive `sub-delay`.
 */
function correlate(sub: Float32Array, audio: Float32Array, steps: number) {
  const n = sub.length
  const curve = new Float32Array(steps * 2 + 1)
  for (let k = -steps; k <= steps; k++) {
    // Only the overlap is scored, so a shift that pushes most of the window off
    // the end is compared on what is left rather than padded with zeros.
    const lo = Math.max(0, -k)
    const hi = Math.min(n, n - k)
    const m = hi - lo
    let sx = 0
    let sy = 0
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (let i = lo; i < hi; i++) {
      const x = sub[i]!
      const y = audio[i + k]!
      sx += x
      sy += y
      sxy += x * y
      sxx += x * x
      syy += y * y
    }
    const cov = sxy / m - (sx / m) * (sy / m)
    const vx = sxx / m - (sx / m) ** 2
    const vy = syy / m - (sy / m) ** 2
    // No cues in range, or a dead-flat stretch of audio: nothing to correlate.
    curve[k + steps] = vx > 1e-9 && vy > 1e-9 ? cov / Math.sqrt(vx * vy) : -1
  }
  return curve
}

/**
 * The peak of a correlation curve, in bins from its middle, and how far it
 * stands above the rest of it.
 *
 * The peak lands between two bins as often as on one, so a parabola through it
 * and its neighbours says where — a fifth of a bin is 40 ms, and the difference
 * between subtitles that feel synced and subtitles that feel nearly synced is
 * smaller than the 200 ms the audio is measured in.
 */
function peakOf(curve: Float32Array, steps: number) {
  let at = 0
  for (let i = 1; i < curve.length; i++) {
    if (curve[i]! > curve[at]!)
      at = i
  }
  const score = curve[at]!

  const l = curve[at - 1]
  const r = curve[at + 1]
  const bend = l !== undefined && r !== undefined ? l + r - 2 * score : 0
  const tweak = bend < 0 ? Math.max(-0.5, Math.min(0.5, (l! - r!) / (2 * bend))) : 0

  // Everything that isn't the winner or its own shoulder: what the peak beat.
  const guard = PEAK_GUARD / BIN
  let sum = 0
  let sq = 0
  let count = 0
  for (let i = 0; i < curve.length; i++) {
    if (Math.abs(i - at) <= guard)
      continue
    sum += curve[i]!
    sq += curve[i]! ** 2
    count++
  }
  const mean = count ? sum / count : 0
  const sd = count ? Math.sqrt(Math.max(0, sq / count - mean ** 2)) : 0

  return { shift: at - steps + tweak, score, confidence: sd > 1e-6 ? (score - mean) / sd : 0 }
}

/**
 * Slide the cues along the audio and keep the fit that correlates best.
 *
 * Both sides are reduced to "is anything being said here" first (`heard`), which
 * is the whole reason this works where correlating against raw loudness didn't:
 * a subtitle file knows when someone speaks and nothing whatever about how loud
 * the film is while they do, so matching the two on level was matching them on
 * the one thing they don't share. Zero-mean correlation on top of that has to
 * match the gaps as well as the dialogue, which is what stops every cue bunching
 * onto the talkiest stretch.
 *
 * `maxShift` is generous on purpose: a file cut for another release is off by a
 * distributor's logo or a missing intro card as often as by a second, and the
 * confidence test above is what keeps the extra room from being extra rope.
 * Cost is one pass per rate per shift — a 20 minute window over ±3 min at five
 * rates is ~54 M multiply-adds, ~130 ms, and it runs on a click.
 */
export function bestSync(cues: Cue[], envelope: Float32Array, from: number, maxShift = 180): Sync {
  const n = envelope.length
  const none: Sync = { offset: 0, speed: 1, score: 0, confidence: 0 }
  if (n * BIN < SYNC_MIN_WINDOW || !cues.length)
    return none

  const audio = heard(envelope)
  const steps = Math.round(maxShift / BIN)
  let best = none

  for (const speed of n * BIN >= RATE_MIN_WINDOW ? RATES : [1]) {
    // mpv's `sub-speed` multiplies timestamps from zero, so the mask is built
    // the same way rather than scaled about the middle of the window — a file
    // authored at the wrong rate is wrong from its first cue, not from here.
    const sub = new Float32Array(n)
    for (const c of cues) {
      const a = Math.max(0, Math.round((c.start * speed - from) / BIN))
      const b = Math.min(n, Math.round((c.end * speed - from) / BIN))
      for (let i = a; i < b; i++)
        sub[i] = 1
    }

    const fit = peakOf(correlate(sub, audio, steps), steps)
    if (fit.score > best.score + (speed === 1 ? 0 : RATE_MARGIN))
      best = { offset: fit.shift * BIN, speed, score: fit.score, confidence: fit.confidence }
  }
  return best
}

// ---------------------------------------------------------------------------
// Look
//
// mpv renders the subtitles, so "font size" is a property on its side, not CSS.
// The settings page edits this shape and the player pushes it over IPC — every
// one of these is live, so a change shows on the next frame.
// ---------------------------------------------------------------------------

export interface SubtitleStyle {
  /** Family name as fontconfig knows it, e.g. "sans-serif", "Roboto". */
  font: string
  /** mpv's `sub-font-size`: points at a 720p-tall window, scaled from there. */
  size: number
  bold: boolean
  /** `#rrggbb` — the picker has no use for an alpha channel. */
  color: string
  /** Outline thickness in the same units as `size`. */
  outline: number
  /** Opacity of the box behind the text, 0–1. 0 draws no box at all. */
  background: number
  /** mpv's `sub-pos`: 100 is the bottom of the frame, 0 the top. */
  position: number
  /**
   * Drop the hearing-impaired additions — "(electricity buzzing)", "MAN:".
   *
   * Not a look, but it lives here because this is the shape the player pushes to
   * mpv on every edit, so the toggle reaches a running film for free and gets
   * carried by the backup like every other preference.
   */
  hideCaptions: boolean
}

export const SUBTITLE_DEFAULTS: SubtitleStyle = {
  font: 'sans-serif',
  size: 38,
  bold: false,
  color: '#ffffff',
  outline: 1.65,
  background: 0,
  position: 100,
  hideCaptions: false,
}

/**
 * How far one press of a stepper moves each number above — one table for the
 * settings page and the player's own Appearance tab, so the two can't step
 * differently. Fine on purpose: the line is judged by eye against a picture,
 * and position used to move a tenth of the frame per press, jumping clean past
 * the spot it was being walked towards.
 */
export const SUBTITLE_STEPS = {
  size: { min: 16, max: 90, step: 1 },
  outline: { min: 0, max: 5, step: 0.1 },
  background: { min: 0, max: 1, step: 0.05 },
  position: { min: 50, max: 120, step: 1 },
} satisfies Record<string, Steps>

/** The colour presets — the whole control on a TV, where no colour canvas can be driven. */
export const SUBTITLE_COLOURS = ['#ffffff', '#f2e14c', '#9fd8ff', '#ffb787', '#c0c0c0']

/** The fonts every desktop and Android build can be assumed to resolve. */
export const SUBTITLE_FONTS = ['sans-serif', 'serif', 'monospace', 'Roboto', 'Arial', 'Verdana', 'Georgia']

/**
 * The same choice as a CSS font stack, for the two places the *webview* draws
 * the subtitles rather than mpv: the `<video>` fallback (Android, a browser)
 * and the settings page's preview.
 *
 * The stored value is the name fontconfig knows, because mpv is what draws them
 * on a desktop — but a webview handed a family it hasn't got falls back to its
 * own default, which is a serif, and not to anything the choice resembled.
 * Measured on Linux: `Roboto`, `Verdana` and `Georgia` all rendered as the same
 * unknown-family fallback, so three of the seven silently did nothing.
 *
 * Roboto is the one the app itself carries — `@fontsource-variable/roboto`
 * registers it as **Roboto Variable**, so asking for plain `Roboto` missed the
 * font sitting in the bundle. The system name stays behind it for Android,
 * where Roboto really is installed. The rest name the generic they are a kind
 * of, which is also what fontconfig substitutes for mpv, so the preview and the
 * player agree about what a machine without Georgia is going to show you.
 *
 * Not @nuxt/fonts: it resolves families over the network at build time (see the
 * `css` block in nuxt.config), Arial, Verdana and Georgia aren't Google's to
 * serve, and a webfont does nothing for mpv, which is what actually renders
 * subtitles on every desktop build.
 */
const FONT_STACK: Record<string, string> = {
  Roboto: `'Roboto Variable', Roboto, sans-serif`,
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Georgia: 'Georgia, Times, serif',
}

export function subtitleFontCss(font: string) {
  return FONT_STACK[font] ?? font
}

/** mpv colours are `#AARRGGBB`, alpha first and 0xff opaque. */
function mpvColor(hex: string, alpha = 1) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0')
  return `#${a}${hex.replace('#', '')}`
}

/**
 * The style as mpv properties, ready to `set_property` one by one.
 *
 * Subtitles that ship their own ASS styling (mostly anime) keep it —
 * mpv only applies these to plain text formats unless `sub-ass-override=force`,
 * which would also throw away the typesetting they exist for.
 */
export function subtitleProps(style: SubtitleStyle): Record<string, string | number | boolean> {
  return {
    'sub-font': style.font,
    'sub-font-size': style.size,
    'sub-bold': style.bold,
    'sub-color': mpvColor(style.color),
    'sub-outline-size': style.outline,
    'sub-outline-color': mpvColor('#000000'),
    // The box is a border style, not just a colour: without this the back
    // colour is only ever drawn as a drop shadow.
    'sub-border-style': style.background > 0 ? 'background-box' : 'outline-and-shadow',
    'sub-back-color': mpvColor('#000000', style.background),
    'sub-pos': style.position,
    // mpv's own SDH filter, live and reversible — no reload needed. The plain
    // flag drops a described-sound line and a speaker label; `harder` also takes
    // an enclosure out of the middle of a line of real dialogue, which is the
    // half of it people actually complain about.
    'sub-filter-sdh': style.hideCaptions,
    'sub-filter-sdh-harder': style.hideCaptions,
  }
}

/**
 * `sub-pos` lifted clear of an overlay `cover` px tall along the bottom of a
 * `height` px picture — mpv draws its subtitles inside its own window, under
 * anything the page puts on top, so an open panel simply hides them.
 *
 * Never below where the user put the line, and never lifted so far that a tall
 * panel parks the text in the middle of the frame.
 */
export function subtitleLift(position: number, cover: number, height: number) {
  if (cover <= 0 || height <= 0)
    return position
  return Math.min(position, Math.max(35, 100 - cover / height * 100))
}

/**
 * The same style as CSS, for the `<video>` path. `height` is the video box in
 * physical layout px: mpv sizes subtitles against a 720-tall window and scales
 * from there, so both sizes have to be derived the same way or the settings
 * preview would be honest on one platform and a lie on the other.
 *
 * Returns what goes on the text itself. Where the line sits is `sub-pos`, which
 * the caller applies to the row around it.
 */
export function subtitleCss(style: SubtitleStyle, height: number) {
  const scale = (height || 720) / 720
  const px = style.size * scale
  return {
    fontFamily: subtitleFontCss(style.font),
    fontSize: `${px.toFixed(1)}px`,
    fontWeight: style.bold ? '700' : '400',
    color: style.color,
    // paint-order keeps the stroke behind the glyph: without it a thick outline
    // is drawn over the letters and eats them from the inside.
    WebkitTextStroke: style.outline > 0 ? `${(style.outline * scale).toFixed(2)}px #000` : '0',
    paintOrder: 'stroke fill',
    backgroundColor: style.background > 0 ? `rgba(0,0,0,${style.background})` : 'transparent',
  }
}
