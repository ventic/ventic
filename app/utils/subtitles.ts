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
 * No OpenSubtitles REST client and no key in the app. That rules the good
 * aggregators out too — the free ones have all grown a per-user key — which is
 * why the search widens sideways instead: the user's own sources are asked as
 * well, since a Stremio addon serves `/subtitles/` off the same base as
 * `/stream/`, and nothing gets added to the app to make that happen.
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
import { imdbIdByTitle, runtimeText } from './tmdb'
import { configuredSources } from './torrents'

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
  /**
   * What the provider called the file, when it says at all — the release name
   * is the one thing that tells you a file was cut for *this* encode.
   *
   * The built-in addon never says: its entries carry a url, a language and an
   * encoding and nothing else, which is why `fileLabel` has a whole second way
   * of describing a file. Other addons do, so it is read where it is offered.
   */
  name?: string
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

/**
 * Every subtitle for a movie, or for one episode of a show.
 *
 * The built-in addon is asked, and so is every source the user configured: one
 * addon base answers `/stream/` and `/subtitles/` off the same URL, so a source
 * that also does subtitles is already in the list and costs one request. Most
 * don't and 404, which is why a failure is only fatal when they all fail — the
 * same rule `findReleases` searches under.
 *
 * `filename` is Stremio's own extra and is what a provider matches a *cut* by
 * rather than just a title. The built-in addon ignores it (it matches on the
 * IMDb id alone, which is the whole reason a list of forty files for one film
 * contains so many that were never cut for the copy being played) — the ones
 * that honour it hand back something already in sync.
 */
export async function findSubtitles(imdbId: string, season = 0, episode = 0, filename = ''): Promise<Subtitle[]> {
  const series = season > 0 && episode > 0
  const id = series ? `${imdbId}:${season}:${episode}` : imdbId
  const extra = filename ? `/filename=${encodeURIComponent(filename)}` : ''
  const path = `/subtitles/${series ? 'series' : 'movie'}/${id}${extra}.json`

  const bases = [ADDON, ...configuredSources().filter(b => b !== ADDON)]
  const results = await Promise.allSettled(bases.map(b => subtitlesFrom(b, path)))
  const failed = results.flatMap(r => r.status === 'rejected' ? [String(r.reason)] : [])
  if (failed.length === results.length)
    throw new Error(`Subtitle search failed — ${failed[0]}`)

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
  return [...seen.values()]
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
  if (!f.cues.length)
    return $t('Unreadable')
  return [
    // Already said by the label when there is no name to show instead.
    f.name && f.captions ? $t('SDH') : '',
    runtimeText(Math.round(subRuntime(f) / 60)),
    $t('{count} lines', { count: f.cues.length }),
  ].filter(Boolean).join(' · ')
}

/**
 * The files of one language, best first: one that covers this video's runtime
 * over one that plainly doesn't, then plain dialogue over the hearing-impaired
 * cut — the addon's own order puts that on top often enough that it can't be
 * trusted as a default. Unreadable ones sink to the bottom.
 *
 * `duration` is the video's, in seconds; 0 where it isn't known yet, which just
 * leaves the fit out of the ordering. The limit is what bounds the cost: each
 * file is ~100 KB of Cloudflare-cached text, fetched in parallel, and a dozen
 * is enough to find a good one without pulling bandwidth off the download.
 */
export async function probeLanguage(lang: SubtitleLanguage, duration = 0, limit = 12): Promise<SubtitleFile[]> {
  const list = await Promise.all(lang.files.slice(0, limit).map(probe))
  return list.sort((a, b) =>
    Number(fitsRuntime(b, duration)) - Number(fitsRuntime(a, duration))
    || Number(a.captions) - Number(b.captions)
    || Number(!a.cues.length) - Number(!b.cues.length))
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
