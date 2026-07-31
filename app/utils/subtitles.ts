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
 */
const RATES = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24]

/**
 * Shortest window worth a verdict, and the shortest that can tell a rate error
 * from a plain shift. Under this the fit has enough freedom to land somewhere
 * confidently wrong: a two-minute window will happily "find" a 75 s shift at the
 * wrong rate and score it well.
 */
export const SYNC_MIN_WINDOW = 600

export interface Sync {
  /** Seconds to shift by — straight into mpv's `sub-delay`. */
  offset: number
  /** Timestamp multiplier for `sub-speed`; 1 unless the file was cut for another rate. */
  speed: number
  /** Correlation at the winning fit, -1 to 1. */
  score: number
  /** The best correlation well away from the winner — what the peak beat. */
  rival: number
}

/**
 * Is this fit worth applying, or should the caller say it couldn't tell?
 *
 * A correlation is only meaningful against its own competition: dialogue is
 * repetitive and a whole scene can line up against the wrong one, so a peak that
 * barely beats the next-best candidate is a coin toss dressed as an answer. The
 * absolute floor rules out a window with no dialogue in it at all.
 */
export function synced(fit: Sync) {
  return fit.score >= 0.12 && fit.score > fit.rival * 1.4
}

/**
 * Slide the cues along the audio envelope and keep the fit that correlates best.
 *
 * The metric is Pearson correlation between a 0/1 subtitle mask and the measured
 * loudness, which is the whole reason this works where counting overlap didn't:
 * overlap only ever punished a cue sitting over silence, never speech left
 * uncovered, so on a film that is loud two thirds of the time the way to score
 * well was to bunch every cue onto the noisiest stretch. Correlation is zero-mean
 * on both sides and has to match the gaps as well as the dialogue.
 *
 * `rates` is left off for a window too short to tell a rate error from a shift.
 * Cost is one pass per rate per shift — a 20 minute window over ±90 s at five
 * rates is ~27 M multiply-adds, a couple of hundred ms, and it runs on a click.
 */
export function bestSync(cues: Cue[], envelope: Float32Array, from: number, maxShift = 90, rates = true): Sync {
  const n = envelope.length
  const none: Sync = { offset: 0, speed: 1, score: 0, rival: 0 }
  if (n * BIN < SYNC_MIN_WINDOW / 2 || !cues.length)
    return none

  const steps = Math.round(maxShift / BIN)
  let best = none
  let bestScore = -1

  for (const speed of rates ? RATES : [1]) {
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

    const curve = new Float32Array(steps * 2 + 1)
    let peak = -1
    let at = 0
    for (let k = -steps; k <= steps; k++) {
      // Only the overlap is scored, so a shift that pushes most of the window
      // off the end is compared on what is left rather than padded with zeros.
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
        const y = envelope[i + k]!
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
      const r = vx > 1e-9 && vy > 1e-9 ? cov / Math.sqrt(vx * vy) : -1
      curve[k + steps] = r
      if (r > peak) {
        peak = r
        at = k
      }
    }

    // The runner-up has to be a different answer, not the same peak one bin over.
    let rival = -1
    for (let k = -steps; k <= steps; k++) {
      if (Math.abs(k - at) * BIN > 3)
        rival = Math.max(rival, curve[k + steps]!)
    }

    if (peak > bestScore) {
      bestScore = peak
      best = { offset: at * BIN, speed, score: peak, rival }
    }
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
