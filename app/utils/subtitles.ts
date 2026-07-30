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
 * plays on without subtitles. The replacement, if it goes for good, is
 * api.opensubtitles.com — an API key plus a per-user login and a download
 * quota, which is the whole reason it isn't the first choice.
 *
 * No OpenSubtitles REST client and no key in the app.
 */
import { imdbIdByTitle } from './tmdb'

const ADDON = 'https://opensubtitles-v3.strem.io'
/**
 * The metadata addon behind Stremio's search box. It indexes IMDb itself,
 *  which is the whole reason `findImdbId` still needs it.
 */
const CINEMETA = 'https://v3-cinemeta.strem.io'

export interface Subtitle {
  id: string
  /** Direct URL to a UTF-8 subtitle file — mpv opens it over http itself. */
  url: string
  /** OpenSubtitles' 3-letter code: ISO 639-2/B and /T mixed, plus its own. */
  lang: string
}

/** The codes Intl doesn't know, because OpenSubtitles invented them. */
const EXTRA_NAMES: Record<string, string> = {
  pob: 'Portuguese (Brazil)',
  zht: 'Chinese (traditional)',
  zhe: 'Chinese (bilingual)',
}

const NAMES = new Intl.DisplayNames(['en'], { type: 'language' })

/**
 * "eng" -> "English". Also how a downloaded subtitle is matched against a track
 * muxed into the file: mkv says "ger", OpenSubtitles says "deu", and only the
 * name they both resolve to can tell you those are the same language.
 */
export function langName(code: string) {
  const c = code.toLowerCase()
  if (EXTRA_NAMES[c])
    return EXTRA_NAMES[c]
  try {
    const name = NAMES.of(c)
    return name && name !== c ? name : code
  }
  catch {
    return code // not a language tag at all
  }
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
  const words = (path.split('/').pop() ?? '')
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z0-9]+/i)
    // The leading number in "2_English" is the muxer's index, not part of a name.
    .filter(w => w && !/^\d+$/.test(w) && !seen.has(w.toLowerCase()))

  const label = (w: string) => NOT_LANGUAGES.test(w) ? w : langName(w)
  const code = words.findLast(w => w.length <= 3 && label(w) !== w) ?? ''
  const name = words.map(label).join(' ') || 'Subtitles'
  return { code, name, files: [{ id: url, url, lang: code }] }
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

    const data = await res.json() as { metas?: { id?: string, releaseInfo?: string }[] }
    const hits = (data.metas ?? []).filter(m => /^tt\d+$/.test(m.id ?? ''))
    // Titles get remade; the year decides between "Dune" and "Dune".
    const hit = (year && hits.find(m => String(m.releaseInfo ?? '').startsWith(year))) || hits[0]
    return hit?.id ?? ''
  }
  catch {
    return '' // offline, or the addon is gone: the caller reports no match
  }
}

/** Every subtitle the addon has for a movie, or for one episode of a show. */
export async function findSubtitles(imdbId: string, season = 0, episode = 0): Promise<Subtitle[]> {
  const series = season > 0 && episode > 0
  const id = series ? `${imdbId}:${season}:${episode}` : imdbId
  const res = await fetch(`${ADDON}/subtitles/${series ? 'series' : 'movie'}/${id}.json`, {
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok)
    throw new Error(`Subtitle search failed (HTTP ${res.status}).`)

  const data = await res.json() as { subtitles?: Subtitle[] }
  return (data.subtitles ?? []).filter(s => s.url && s.lang)
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
    while (++i < lines.length && lines[i]!.trim())
      body.push(lines[i]!.trim())
    out.push({ start, end, text: body.join('\n') })
  }
  return out
}

/** "(electricity buzzing)", "- [door creaks]", "MAN:" — described sound, not dialogue. */
const CAPTION_LINE = /^-?\s*(?:[[(][^\])]*[\])]\s*[.,!?]?$|[A-Z][A-Z0-9 .'#-]{2,}:)/

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
}

/** Downloaded once per url and kept — the same file is re-read on every sync. */
const files = new Map<string, SubtitleFile>()

export async function probe(s: Subtitle): Promise<SubtitleFile> {
  const hit = files.get(s.url)
  if (hit)
    return hit

  let text = ''
  try {
    const res = await fetch(s.url, { signal: AbortSignal.timeout(20000) })
    text = res.ok ? await res.text() : ''
  }
  catch {
    // Offline or a dead mirror: it lists as unreadable and mpv can still try it.
  }
  const cues = parseCues(text)
  const file: SubtitleFile = { ...s, cues, captions: isCaptions(cues) }
  files.set(s.url, file)
  return file
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

/**
 * The files of one language, plain dialogue first: the addon's own order puts
 * the hearing-impaired cut on top often enough that it can't be trusted as a
 * default. Unreadable ones sink to the bottom.
 */
export async function probeLanguage(lang: SubtitleLanguage, limit = 8): Promise<SubtitleFile[]> {
  const list = await Promise.all(lang.files.slice(0, limit).map(probe))
  return list.sort((a, b) =>
    Number(a.captions) - Number(b.captions) || Number(!a.cues.length) - Number(!b.cues.length))
}

// ---------------------------------------------------------------------------
// Auto-sync
// ---------------------------------------------------------------------------

/** [start, end] in seconds from the start of the file. */
export type Interval = [number, number]

/** Resolution of both timelines. Finer than this is below what anyone notices. */
const BIN = 0.2

export interface Offset {
  /** Seconds to shift the subtitles by — straight into mpv's `sub-delay`. */
  offset: number
  /** Share of subtitle time that lands on speech at that shift, 0–1. */
  score: number
  /** The same share as it is now, to tell "already fine" from "fixed it". */
  base: number
}

/**
 * Slide the cues over the audio and keep the shift where they cover speech best.
 * Both timelines are 0/1 masks in BIN-second buckets and the score is their
 * overlap — the trick ffsubsync uses, minus the FFT: a 10 minute window over
 * ±90 s of shift is a few million adds, which is nothing.
 *
 * Here "not silent" stands in for "someone is speaking", so a wall-to-wall
 * score can leave nothing to lock onto — the caller checks `score` before
 * trusting it. A real VAD (ffsubsync, alass) is the upgrade if that shows up.
 */
export function bestOffset(cues: Cue[], silence: Interval[], from: number, to: number, maxShift = 90): Offset {
  const n = Math.floor((to - from) / BIN)
  if (n < 100 || !cues.length)
    return { offset: 0, score: 0, base: 0 }

  // Both masks round their edges the same way, so a perfect fit scores ~1 rather
  // than losing a bin at every boundary to opposite rounding.
  const fill = (mask: Float32Array, s: number, e: number, v: number) => {
    for (let i = Math.max(0, Math.round((s - from) / BIN)); i < Math.min(n, Math.round((e - from) / BIN)); i++)
      mask[i] = v
  }

  const speech = new Float32Array(n).fill(1)
  for (const [s, e] of silence)
    fill(speech, s, e, 0)

  // A stretch that is never quiet — wall-to-wall score, music under everything —
  // has nothing to lock onto, and every shift would look perfect. Say so instead
  // of returning a confident zero the caller would read as "already in sync".
  if (speech.reduce((a, b) => a + b, 0) * 10 > n * 9)
    return { offset: 0, score: 0, base: 0 }

  const sub = new Float32Array(n)
  for (const c of cues)
    fill(sub, c.start, c.end, 1)

  const score = (k: number) => {
    let hit = 0
    let total = 0
    for (let i = 0; i < n; i++) {
      const j = i + k
      if (!sub[i] || j < 0 || j >= n)
        continue
      total++
      hit += speech[j]!
    }
    // Shifted so far that barely any of it is still inside the window: no verdict.
    return total * 40 > n ? hit / total : 0
  }

  // Outwards from no shift at all, so that when several shifts fit equally well
  // — dialogue is repetitive, and a whole scene can line up against the wrong
  // one — the answer is the smallest move, and a shift has to beat standing
  // still outright to be worth making.
  const steps = Math.round(maxShift / BIN)
  const base = score(0)
  let offset = 0
  let best = base
  for (let k = 1; k <= steps; k++) {
    for (const dir of [-1, 1]) {
      const s = score(k * dir)
      if (s > best) {
        best = s
        offset = k * dir * BIN
      }
    }
  }
  return { offset, score: best, base }
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
}

export const SUBTITLE_DEFAULTS: SubtitleStyle = {
  font: 'sans-serif',
  size: 38,
  bold: false,
  color: '#ffffff',
  outline: 1.65,
  background: 0,
  position: 100,
}

/** The fonts every desktop and Android build can be assumed to resolve. */
export const SUBTITLE_FONTS = ['sans-serif', 'serif', 'monospace', 'Roboto', 'Arial', 'Verdana', 'Georgia']

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
  }
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
    fontFamily: style.font,
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
