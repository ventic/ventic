/**
 * Finding something to play, and handing it to the local torrent engine.
 *
 * The app indexes nothing and ships with no sources: this file searches only
 * the servers a user has added by hand. A source is a URL that answers
 * `GET {base}/stream/{movie|series}/{imdbId}.json` with a `streams` array — an
 * open, documented protocol with several independent implementations, so what
 * a given source returns is between its operator and the user who added it.
 *
 * A list of URLs, not a plugin runtime. The protocol is plain HTTP
 * and JSON, so a source needs no sandbox, no manifest, and runs no code of
 * ours — the fan-out below is the entire "plugin system".
 */
import { deviceCodecs, hasNativePlayer } from './htmlvideo'

/**
 * Sources to search, in the order they were added. Empty until the user adds
 * one; the settings store pushes the list on change, the same way it pushes
 * the download folder to `setDownloadDir`.
 */
let sources: string[] = []

// A function, not a constant: it is built when this module loads, before `$t`
// has a locale to read — see SECTIONS in the settings store.
export const NO_SOURCES = () => $t('No sources configured. Add one in Settings → Sources.')

export function setSources(urls: string[]) {
  // Trailing slashes would produce `//stream/…`, which some servers 404.
  sources = urls.map(u => u.trim().replace(/\/+$/, '')).filter(Boolean)
}

/**
 * The same list, for the subtitle search. One addon protocol serves `/stream/`
 * and `/subtitles/` off the same base, so an addon the user already trusts for
 * releases is asked about subtitles too — still nothing this app added itself.
 */
export function configuredSources() {
  return sources
}

/**
 * What a user actually has on the clipboard — or what arrived on a `ventic://`
 * link — turned into a base URL we can append `/stream/…` to. Nobody copies a
 * bare origin: an addon hands out a scheme link or a `…/manifest.json` URL, and
 * a configured one carries its settings in the path
 * (`https://host/opt=a,b/manifest.json`), which is part of the base and has to
 * survive. A bare host is taken as https, which is the form someone typing it
 * from memory produces.
 *
 * Returns '' for anything that isn't a URL, so the caller can say so.
 */
export function normalizeSource(input: string): string {
  // `ventic://` is our own deep link, `stremio://` is what addon pages
  // already publish; both name an https server in the same shape.
  const typed = input.trim().replace(/^(?:ventic|stremio):\/\//i, 'https://')

  // A bare host is what people actually have in front of them, and typing
  // "https://" on a TV keyboard costs eight presses of a d-pad. https is the
  // only scheme this accepts anyway, so assume it rather than refuse the input.
  const url = (/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`)
    .replace(/\/manifest\.json(?:[?#].*)?$/i, '')
    .replace(/\/+$/, '')

  return /^https?:\/\/[^\s/]+/i.test(url) ? url : ''
}

/** Public trackers, so a magnet without any of its own still finds peers fast. */
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.tracker.cl:1337/announce',
]

/**
 * Streaming preference, best first. 1080p is the sweet spot; 4k needs more
 * bandwidth than most connections give a torrent, so it sits below 720p.
 */
const QUALITY_ORDER = ['1080p', '720p', '2160p', '480p']

/** Sources label one tier "4k" or "2160p". Nothing past here should have to know. */
function tier(quality: string) {
  const q = quality.toLowerCase()
  return q.startsWith('4k') ? '2160p' : QUALITY_ORDER.find(t => q.startsWith(t)) ?? ''
}

/**
 * The tiers, best first, with whatever the user asked for moved to the front.
 *
 * Held rather than worked out in `rank`, which is called twice per comparison
 * inside a sort of everything a search returned — that was a fresh array each
 * time, for an answer that only changes when the setting does.
 */
let order: readonly string[] = QUALITY_ORDER

/**
 * The tier to try first, '' for "whatever streams best". Pushed in rather than
 * read out of a store, the same as `setSources`: the `check:*` scripts reach
 * this file with no Nuxt around it.
 *
 * A preference moves one tier to the front and leaves the rest as they were. It
 * is an order and not a filter, which is the whole fallback: a tier with nothing
 * live in it has nothing to rank, so the next one down wins on its own.
 */
export function setQuality(value: string) {
  const want = tier(value)
  order = want ? [want, ...QUALITY_ORDER.filter(q => q !== want)] : QUALITY_ORDER
}

/** The choices offered under Settings → Sources. */
export const QUALITIES: { value: string, title: () => string }[] = [
  { value: '', title: () => $t('Automatic') },
  { value: '720p', title: () => $t('720p') },
  { value: '1080p', title: () => $t('1080p') },
  { value: '2160p', title: () => $t('4K') },
]

/**
 * Past this a release is a remux or a needlessly fat encode: the same picture
 * at several times the bitrate, which is bandwidth a torrent stream doesn't
 * have. A 1080p feature is done in ~3 GB, so the 12 GB copy of it stops
 * outranking the small one just because it has more seeders.
 */
const SWEET_BYTES: Record<string, number> = {
  '1080p': 6 * 1024 ** 3,
  '720p': 3 * 1024 ** 3,
  '2160p': 20 * 1024 ** 3,
  '480p': 2 * 1024 ** 3,
}

/**
 * The other end of `SWEET_BYTES`, and the one the label lies about: a copy this
 * much lighter than the rest of its own tier is 1080p by pixel count and by
 * nothing else — same frame size, a third of the bits, and it looks it.
 *
 * No bitrate-per-minute table, because every release in the list is the same
 * film: the other copies of it are the yardstick. That needs no runtime plumbed
 * in, never goes stale as encoders improve, and reads a 25-minute episode and a
 * three-hour feature alike.
 */
const STARVED = 0.5
/** Fewer copies than this in a tier and there is no "normal" to be under. */
const SAMPLE = 4
/** Enough of a swarm to stream from. Under it a tier is a promise, not a copy. */
const THIN = 5

/** Remuxes stream badly on anything but a LAN — a 60 GB movie never keeps up. */
const MAX_BYTES = 25 * 1024 ** 3

/** What this app counts as a film — the containers mpv and ExoPlayer both open. */
export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'webm', 'avi', 'mov', 'm4v', 'ts', 'm2ts', 'flv', 'wmv']

const VIDEO_EXT = new RegExp(`\\.(?:${VIDEO_EXTENSIONS.join('|')})$`, 'i')

/**
 * Text subtitles only. VobSub (`.sub` + `.idx`) is a pair of files mpv can only
 * pair up on a local disk, and it's one http URL each here — a picker entry that
 * could never play is worse than no entry.
 */
const SUBTITLE_EXT = /\.(?:srt|ass|ssa|vtt)$/i

/** Never worth playing, however many seeders it has. */
const JUNK = /\b(?:cam|hdcam|ts|hdts|telesync|telecine|scr|screener|r5)\b/i

const UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }

/**
 * One result a source returned. Most are torrents, but the same protocol also
 * carries plain HTTP links — that is what a debrid addon answers with, having
 * already fetched the torrent on its own servers, and what an addon that hosts
 * its own files answers with. A release has an info hash or a `url`, never both.
 */
export interface Release {
  /** Release name, e.g. "Sintel 2010 1080p BluRay x264". */
  name: string
  hash: string
  /**
   * A link to play directly, '' for a torrent. It needs no swarm, no metadata
   * round trip and no disk, so a release that has one is preferred within its
   * quality tier and is exempt from the storage budget.
   */
  url: string
  /** Index of the wanted file inside the torrent, when the source knows it. */
  fileIdx: number | null
  /**
   * The file inside the torrent this result points at, when the source names one.
   * Only season packs have it, and it's the only place the episode is spelled
   * out — the release name above says "S01", not which episode.
   */
  file: string | null
  seeders: number
  /** Human size of the file we'd stream, e.g. "2.1 GB". */
  size: string
  bytes: number
  /** Whatever the source labelled the result's origin with, if anything. */
  source: string
  /** "1080p", "720p", "4k DV | HDR", … as labelled by the source. */
  quality: string
  magnet: string
}

interface RawStream {
  name?: string
  title?: string
  /** What `title` was renamed to; addons emit one or the other. */
  description?: string
  infoHash?: string
  fileIdx?: number
  url?: string
  sources?: string[]
  behaviorHints?: { videoSize?: number, filename?: string }
}

function magnetFor(hash: string, name: string, sources?: string[]) {
  // A stream's `sources` are prefixed entries: "tracker:udp://…", "dht:<hash>".
  const own = (sources ?? []).filter(s => s.startsWith('tracker:')).map(s => s.slice(8))
  const trackers = [...new Set([...own, ...TRACKERS])]
  const tr = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('')
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${tr}`
}

/**
 * One stream from a source -> one release. Everything but the info hash lives
 * in a multi-line display title whose stats line reads
 * `👤 375 💾 928.25 MB ⚙️ origin`, so it gets parsed back out here.
 */
export function toRelease(raw: RawStream): Release | null {
  // Either something to fetch or something to open. A stream with neither hands
  // playback to another app or another protocol, which is not ours to follow.
  const url = /^https?:\/\//i.test(raw.url ?? '') ? raw.url! : ''
  if (!raw.infoHash && !url)
    return null

  const title = raw.description || raw.title || ''
  const lines = title.split('\n').map(line => line.trim())
  const name = lines[0] || (raw.behaviorHints?.filename ?? '')
  if (!name || JUNK.test(name))
    return null

  const [, amount, unit] = title.match(/💾\s*([\d.]+)\s*([KMGT]?B)/) ?? []
  // Debrid addons have already resolved the file, so they tend to give its
  // exact length here instead of drawing the stats line a torrent needs.
  const bytes = amount ? Number(amount) * (UNITS[unit!] ?? 0) : raw.behaviorHints?.videoSize ?? 0

  return {
    name,
    hash: raw.infoHash ?? '',
    url,
    fileIdx: raw.fileIdx ?? null,
    file: lines.slice(1).find(line => VIDEO_EXT.test(line)) ?? null,
    seeders: Number(title.match(/👤\s*(\d+)/)?.[1] ?? 0),
    size: amount ? `${amount} ${unit}` : bytes ? bytesText(bytes) : '',
    bytes,
    // "⚙️" is a gear plus a variation selector — match the gear, skip whatever
    // decoration follows it, and take the next word.
    source: title.match(/⚙\S*\s+(\S+)/)?.[1] ?? 'unknown',
    // The source's own label line: "<source name>\n1080p".
    quality: ((raw.name ?? '').split('\n')[1] ?? '').trim(),
    magnet: raw.infoHash ? magnetFor(raw.infoHash, name, raw.sources) : '',
  }
}

/** What makes two results the same result — a hash for a torrent, the link itself for a link. */
export function releaseKey(r: Release) {
  return r.url || r.hash
}

function rank(t: Release) {
  const i = order.indexOf(tier(t.quality))
  return i === -1 ? QUALITY_ORDER.length : i
}

/** More bytes than this tier needs to look good — a bigger bill for the same picture. */
export function isBloated(t: Release) {
  return t.bytes > (SWEET_BYTES[tier(t.quality)] ?? MAX_BYTES)
}

/**
 * Which of these give their own tier away on size — see `STARVED`. Built once
 * per pick rather than asked per release, because what it compares against is
 * the list's median and not anything the release carries.
 */
function starvedIn(list: Release[]) {
  const sizes = new Map<string, number[]>()
  for (const t of list) {
    if (!t.bytes)
      continue
    const seen = sizes.get(tier(t.quality)) ?? []
    seen.push(t.bytes)
    sizes.set(tier(t.quality), seen)
  }

  const floor = new Map<string, number>()
  for (const [key, all] of sizes) {
    // Two copies are each other's outlier. Say nothing rather than guess.
    if (all.length < SAMPLE)
      continue
    all.sort((a, b) => a - b)
    floor.set(key, all[all.length >> 1]! * STARVED)
  }

  return (t: Release) => !!t.bytes && t.bytes < (floor.get(tier(t.quality)) ?? 0)
}

/**
 * What a release name says it carries, and how to ask this device about each.
 *
 * A name is all a source gives us to go on, but it is only half the question —
 * the other half is which player is behind the controls, and they differ wildly:
 *
 *   - `android` is a MediaCodec mime type, answered from the platform's own
 *     decoder list (see `deviceCodecs`). This is why the same release is fine on
 *     an Android TV box, which nearly always has Dolby and HEVC in hardware, and
 *     silent on a mid-range phone, which often has neither.
 *   - `mime` is what MediaSource is asked where the player is the webview's
 *     `<video>` — a browser, i.e. `bun run dev`. TrueHD has none because there
 *     is no MSE string for it, and no webview has ever decoded one.
 */
const CODECS = [
  { re: /\be-?ac-?3\b|\bdd[p+]/i, android: 'audio/eac3', mime: 'audio/mp4; codecs="ec-3"' },
  { re: /\bac-?3\b|\bdd5[\W_]?1\b/i, android: 'audio/ac3', mime: 'audio/mp4; codecs="ac-3"' },
  { re: /\bdts/i, android: 'audio/vnd.dts', mime: 'audio/mp4; codecs="dtsc"' },
  { re: /\btruehd\b|\batmos\b/i, android: 'audio/true-hd', mime: '' },
  { re: /\bx265\b|\bh\.?265\b|\bhevc\b/i, android: 'video/hevc', mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
  { re: /\bav1\b/i, android: 'video/av01', mime: 'video/mp4; codecs="av01.0.05M.08"' },
  // Main 10. MediaCodec doesn't split HEVC by profile, and in practice a device
  // with a hardware HEVC decoder has the 10-bit profile too.
  { re: /\b10.?bits?\b/i, android: 'video/hevc', mime: 'video/mp4; codecs="hvc1.2.4.L120.B0"' },
]

/**
 * No codec to ask about — a remux is a full-bitrate disc, which is a bandwidth
 *  problem before it is a decoding one.
 */
const RISKY = /\bremux\b/i

/**
 * Can the player on this device decode this? `null` where there is nobody to ask
 * — a `bun run check:*` with no browser around it — and the caller falls back to
 * the release name alone, which is the cautious answer.
 */
function canDecode(c: { android: string, mime: string }): boolean | null {
  const codecs = deviceCodecs()
  if (codecs)
    return codecs.has(c.android)
  const mse = (globalThis as { MediaSource?: { isTypeSupported?: (type: string) => boolean } }).MediaSource
  if (c.mime && mse?.isTypeSupported)
    return mse.isTypeSupported(c.mime)
  return null
}

export function isAwkward(t: Release) {
  // mpv carries its own ffmpeg and cares about none of this.
  if (hasNativePlayer())
    return false
  const name = `${t.name} ${t.quality}`
  return RISKY.test(name) || CODECS.some(c => c.re.test(name) && canDecode(c) !== true)
}

/**
 * Best quality tier we'd actually stream, then the copies of it that aren't
 * bloated, and within those the most seeders. `maxBytes` is the device's storage
 * budget: a release that can't fit on the disk is no use however good it is.
 *
 * `compatible` breaks ties towards what this device can actually decode, which
 * `isAwkward` now asks the platform rather than guessing from the name — so a TV
 * box keeps the Dolby copy it can play and a phone without the decoder doesn't.
 *
 * It stays *below* the quality tier: dropping a whole tier to dodge a codec is
 * the wrong trade now that the check is accurate, since anything it demotes is
 * something this device genuinely cannot play at any resolution.
 *
 * A direct link wins the last tiebreak before seeders: same picture, same
 * bitrate, but it starts at once and nothing has to be kept on the disk.
 *
 * A copy that gives its tier away is ranked as the tier below rather than
 * dropped — too few bits for the label (`STARVED`), or too few peers to deliver
 * them (`THIN`). Demoted and not removed because it is still the best thing here
 * when there is nothing under it, which is the whole of the 4k fallback: ask for
 * 2160p, and a 2160p nobody is seeding loses to a healthy 1080p on its own.
 */
export function pickBest(list: Release[], maxBytes = MAX_BYTES, compatible = false): Release | null {
  const limit = Math.min(MAX_BYTES, maxBytes)
  const starved = starvedIn(list)
  const at = (t: Release) => rank(t) + Number(starved(t) || (!t.url && t.seeders < THIN))
  return [...list]
    // Neither test applies to a link: there is no swarm to have seeders, and
    // nothing is written to the disk the budget is protecting.
    .filter(t => !!t.url || (t.seeders > 0 && (!t.bytes || t.bytes <= limit)))
    .sort((a, b) =>
      at(a) - at(b)
      || (compatible ? Number(isAwkward(a)) - Number(isAwkward(b)) : 0)
      || Number(isBloated(a)) - Number(isBloated(b))
      || Number(!a.url) - Number(!b.url)
      || b.seeders - a.seeders)[0] ?? null
}

async function searchOne(base: string, path: string): Promise<Release[]> {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(20000) })
  if (!res.ok)
    throw new Error(`${base} answered HTTP ${res.status}`)

  const data = await res.json() as { streams?: RawStream[] }
  return (data.streams ?? []).flatMap(s => toRelease(s) ?? [])
}

/**
 * Everything the configured sources know for a movie, or for one episode of a
 * show. Sources are searched together and their results merged: one being
 * down or slow costs its results, not the search.
 */
export async function findReleases(imdbId: string, season = 0, episode = 0): Promise<Release[]> {
  if (!sources.length)
    throw new Error(NO_SOURCES())

  const series = season > 0 && episode > 0
  const id = series ? `${imdbId}:${season}:${episode}` : imdbId
  const path = `/stream/${series ? 'series' : 'movie'}/${id}.json`

  const results = await Promise.allSettled(sources.map(base => searchOne(base, path)))
  const failed = results.flatMap(r => r.status === 'rejected' ? [String(r.reason)] : [])
  // One source down out of several is not worth an error. All of them is — and
  // it reads the same as "nothing found" unless we say so.
  if (failed.length === results.length)
    throw new Error($t('No source answered — {reason}', { reason: failed[0]! }))

  // Two sources drawing on the same origins hand back the same release twice;
  // first one wins, so the order sources were added in is the preference order.
  const seen = new Map<string, Release>()
  for (const t of results.flatMap(r => r.status === 'fulfilled' ? r.value : [])) {
    if (!seen.has(releaseKey(t)))
      seen.set(releaseKey(t), t)
  }

  return [...seen.values()]
}

// --- Local engine -------------------------------------------------------------
// The librqbit HTTP + streaming server the Tauri backend starts on boot
// (src-tauri/src/lib.rs). Everything below is plain fetch() against it.

export const ENGINE = 'http://127.0.0.1:3030'

export interface EngineFile {
  name: string
  length: number
  included: boolean
  /** Path parts relative to the torrent's output folder, last one the file. */
  components?: string[]
}

export interface TorrentStats {
  /** "initializing" | "live" | "paused" | "error" */
  state: string
  error: string | null
  progress_bytes: number
  uploaded_bytes: number
  total_bytes: number
  finished: boolean
  /** Bytes we hold of each file, in the torrent's own file order. */
  file_progress: number[]
  live: null | {
    download_speed: { mbps: number, human_readable: string }
    upload_speed: { mbps: number, human_readable: string }
    time_remaining: { human_readable: string } | null
    snapshot: { peer_stats: { live: number, seen: number } }
  }
}

/** A torrent as the engine lists it. */
export interface EngineTorrent {
  id: number
  info_hash: string
  name: string | null
  output_folder: string
  files?: EngineFile[]
  stats?: TorrentStats
  /** How many pieces the torrent is cut into. See `pieceMap`. */
  total_pieces?: number
}

/**
 * Where new torrents are written, from the storage setting. Empty means the
 * engine's own default (a folder in the app's cache dir). It lives here rather
 * than being threaded through every caller because `addTorrent` is the only
 * place a torrent is ever created — the settings store pushes it on change.
 */
let downloadDir = ''

export function setDownloadDir(path: string) {
  downloadDir = path.trim()
}

export async function addTorrent(magnet: string) {
  // Only new torrents move: the engine remembers an existing one's folder, and
  // its data is already sitting in it.
  const folder = downloadDir ? `&output_folder=${encodeURIComponent(downloadDir)}` : ''
  const res = await fetch(`${ENGINE}/torrents?overwrite=true${folder}`, { method: 'POST', body: magnet })
  if (!res.ok)
    throw new Error($t('Torrent engine said {status}: {reason}', { status: res.status, reason: await res.text() }))
  const added = await res.json() as {
    id: number | null
    details: { name: string | null, info_hash: string, files: EngineFile[] | null }
  }
  if (added.id == null)
    throw new Error($t('The torrent engine accepted the magnet but gave it no id.'))
  return { ...added, id: added.id }
}

/**
 * How release names spell one episode: "S01E02", "s1e2", "S01.E02", "1x02".
 * `0*` covers both zero-padded and bare numbers, and the trailing guard keeps
 * E02 from matching E020.
 */
function episodePattern(season: number, episode: number) {
  return new RegExp(`(?:s0*${season}[\\s._-]*e0*${episode}|\\b0*${season}x0*${episode})(?!\\d)`, 'i')
}

/**
 * Which file inside the torrent to play. A season pack holds every episode and
 * only the file names say which is which, so the wanted episode is matched by
 * name first — the addon's `fileIdx` is missing on plenty of sources, and
 * falling straight through to "largest video" is what quietly plays episode 1
 * when you asked for episode 2.
 */
export function pickVideoFile(
  files: EngineFile[],
  hint: number | null,
  want?: { season?: number, episode?: number },
) {
  const videos = files
    .map((f, index) => ({ ...f, index }))
    .filter(f => VIDEO_EXT.test(f.name))
  if (!videos.length)
    return null

  if (want?.season && want?.episode) {
    const pattern = episodePattern(want.season, want.episode)
    const match = videos.find(f => pattern.test(f.name))
    if (match)
      return match.index
  }

  if (hint != null && videos.some(f => f.index === hint))
    return hint

  // A torrent already in the engine remembers what it was narrowed to, which is
  // the file someone picked last time — better than guessing again.
  const included = videos.filter(f => f.included)
  const from = included.length && included.length < videos.length ? included : videos
  return from.sort((a, b) => b.length - a.length)[0]!.index
}

/** Full path inside the torrent — a `Subs/` folder spells the episode there. */
function filePath(f: EngineFile) {
  return f.components?.length ? f.components.join('/') : f.name
}

/** The episode a file name spells out, if it spells one at all. */
function episodeIn(name: string) {
  const m = name.match(/\bs(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)|\b(\d{1,2})x(\d{2})(?!\d)/i)
  return m ? { season: Number(m[1] ?? m[3]), episode: Number(m[2] ?? m[4]) } : null
}

/**
 * The first token in a release name that can only be a technical detail, which
 * is therefore where the title stops. Year, season/episode, resolution, source,
 * codec, audio — in roughly the order they actually turn up.
 *
 * Deliberately short. Every extra word is a chance to cut a real title in half,
 * and a name almost always reaches one of the first three before anything else.
 */
const DETAIL = /\b(?:(?:19|20)\d{2}|s\d{1,2}(?:[\s.,_-]*e\d{1,3})?|\d{1,2}x\d{2}|\d{3,4}p|4k|uhd|bluray|blu-ray|bdrip|brrip|dvdrip|web-?dl|web-?rip|hdtv|hdrip|remux|amzn|dsnp|atvp|x26[45]|h\.?26[45]|hevc|avc|xvid|divx|aac|ac3|eac3|ddp?\d|truehd|atmos|repack|proper|extended|uncut|imax|complete|season)\b/gi

/** What a release name says once the scene furniture is taken off it. */
export interface ReleaseName {
  /** "House.of.the.Dragon.S01.1080p…" -> "House of the Dragon". */
  title: string
  year: string
  /** 0 when the name doesn't say. */
  season: number
  episode: number
}

/**
 * Take a release name apart into something a metadata service can be searched
 * with. `House.of.the.Dragon.S01.1080p.BluRay.x265[eztv.re]` is not a title any
 * catalogue has ever heard of, and handing it to one whole is why a magnet used
 * to find no subtitles at all.
 *
 * Scene and p2p names are `Title.Separators.Then.Every.Technical.Detail`, so the
 * title is simply everything before the first detail. Two things stop that from
 * eating real titles:
 *
 * - A year later than next year is part of the name, not a release year, which
 *   is what keeps *Blade Runner 2049* whole.
 * - A detail with nothing in front of it isn't the boundary — otherwise *1917*
 *   and *2012* parse to an empty title and match everything.
 *
 * ponytail: a title whose own words are release tokens ("Alien: Covenant" is
 * fine, "The Post 2017" is fine, but "4K" or "Extended Family" would clip) is
 * left clipped. Reach for a real parser (parse-torrent-title) only if that ever
 * shows up in practice — this is 20 lines and covers everything seen so far.
 */
export function parseRelease(name: string): ReleaseName {
  const text = (name.split('/').pop() ?? '')
    // A container extension, and the tracker's tag: "[eztv.re]", "(YTS.MX)".
    .replace(/\.(?:mkv|mp4|avi|m4v|mov|ts|webm)$/i, '')
    .replace(/[._]+/g, ' ')
    .trim()

  const limit = new Date().getFullYear() + 1
  const plausible = (token: string) => !/^\d{4}$/.test(token) || Number(token) <= limit

  let cut = text.length
  for (const m of text.matchAll(DETAIL)) {
    if (m.index && plausible(m[0])) {
      cut = m.index
      break
    }
  }

  // What's left over from a title: a leading tracker tag, and the bracket a
  // year was opened with, which the cut lands in the middle of.
  const title = text.slice(0, cut)
    .replace(/[[(][^\])]*[\])]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—:[(]+$/, '')
    .trim()

  // The year is the first plausible one *after* the title, so the 2049 in
  // "Blade Runner 2049 2017" is read as part of the name and the 2017 as a year.
  const year = text.slice(cut).match(/\b(?:19|20)\d{2}\b/)
  const ep = episodeIn(text)
  return {
    title,
    year: year && plausible(year[0]) ? year[0] : '',
    season: ep?.season ?? Number(text.match(/\bs(\d{1,2})\b/i)?.[1] ?? 0),
    episode: ep?.episode ?? 0,
  }
}

/**
 * The subtitle files that belong to the video being played, so they come down
 * with it. A release that ships its own is the best copy there is — already cut
 * to this exact encode, and no OpenSubtitles round trip to get it.
 *
 * The whole difficulty is a season pack, where 60 subtitle files sit beside 60
 * episodes: the episode number is the only thing tying one to the other, and it
 * is spelled out whether they're siblings (`Show.S01E07.eng.srt`) or filed under
 * `Subs/Show.S01E07/2_English.srt`. With a single video in the torrent there is
 * nothing to tell apart, and the few MB of taking every language it ships buys
 * the whole picker.
 */
export function pickSubtitleFiles(files: EngineFile[], video: number): number[] {
  const subs = files.flatMap((f, index) => SUBTITLE_EXT.test(f.name) ? [{ f, index }] : [])
  if (!subs.length)
    return []

  const name = files[video]?.name ?? ''
  if (files.filter(f => VIDEO_EXT.test(f.name)).length < 2)
    return subs.map(s => s.index)

  const ep = episodeIn(name)
  // A pack whose files carry no episode number at all: the video's own name is
  // then the shared part, which is what a `.eng.srt` beside it repeats.
  const wanted = ep
    ? (path: string) => episodePattern(ep.season, ep.episode).test(path)
    : (path: string) => path.includes(name.replace(/\.[^.]+$/, ''))

  return subs.filter(s => wanted(filePath(s.f))).map(s => s.index)
}

/**
 * Download only these files. Without it a season pack quietly pulls all 60
 * episodes down while you watch one of them.
 */
export async function limitToFiles(id: number, indexes: number[]) {
  await fetch(`${ENGINE}/torrents/${id}/update_only_files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ only_files: indexes }),
  }).catch(() => {}) // best effort: failing here only costs disk, not playback
}

/** One torrent with its file list — the list endpoint doesn't carry files. */
export async function torrentDetails(id: number): Promise<EngineTorrent | null> {
  try {
    const res = await fetch(`${ENGINE}/torrents/${id}`)
    return res.ok ? await res.json() as EngineTorrent : null
  }
  catch {
    return null
  }
}

export function streamUrl(id: number, index: number) {
  return `${ENGINE}/torrents/${id}/stream/${index}`
}

/** The `{id}/stream/{index}` a stream URL names, or null for a debrid `url`. */
export function streamParts(url: string) {
  const m = /\/torrents\/(\d+)\/stream\/(\d+)/.exec(url)
  return m ? { id: Number(m[1]), index: Number(m[2]) } : null
}

/**
 * Where one file sits in the torrent's flat byte stream, and how many pieces the
 * whole thing is cut into. Enough to turn a position in a film into a piece
 * index: pieces are uniform, so the index is that byte's share of the total and
 * the piece length itself never has to be known.
 */
export interface PieceMap {
  start: number
  length: number
  total: number
  pieces: number
}

export async function pieceMap(id: number, index: number): Promise<PieceMap | null> {
  const t = await torrentDetails(id)
  const file = t?.files?.[index]
  if (!file || !t?.total_pieces)
    return null
  return {
    start: t.files!.slice(0, index).reduce((n, f) => n + f.length, 0),
    length: file.length,
    total: t.files!.reduce((n, f) => n + f.length, 0),
    pieces: t.total_pieces,
  }
}

/**
 * Which pieces are on disk, one bit each, high bit of each byte first — the same
 * bitfield peers exchange. Worth refetching: it fills in as the download runs.
 */
export async function torrentHaves(id: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${ENGINE}/torrents/${id}/haves`, { headers: { accept: 'application/octet-stream' } })
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  }
  catch {
    return null
  }
}

/**
 * Can `fraction` of the way into that file be read without asking the swarm?
 *
 * Bitrate isn't constant, so a timestamp's byte offset is an estimate, and
 * decoding one frame reads on either side of it anyway. Hence the neighbours:
 * the answer has to stay false while any of the bytes a decoder would touch are
 * still missing, or reading them puts a piece request in front of the film.
 */
export function haveAt(map: PieceMap, haves: Uint8Array, fraction: number) {
  // Uniform pieces, so a byte's index is its share of the torrent. The last
  // piece is short, which rounds one past the end — hence the clamp.
  const at = (byte: number) => Math.min(map.pieces - 1, Math.floor((byte / map.total) * map.pieces))
  const first = at(map.start)
  const last = at(map.start + map.length)
  const piece = at(map.start + Math.max(0, Math.min(1, fraction)) * map.length)
  // A neighbour outside the file is nothing to wait for: no decoder reads past
  // the file's own bytes, and another file may not even be selected.
  const has = (i: number) => i < first || i > last || !!(haves[i >> 3]! & (0x80 >> (i & 7)))
  return has(piece - 1) && has(piece) && has(piece + 1)
}

/** Everything the engine holds, stats included — one request per poll. */
export async function listTorrents(): Promise<EngineTorrent[]> {
  const res = await fetch(`${ENGINE}/torrents?with_stats=true`)
  if (!res.ok)
    throw new Error($t('Torrent engine said {status}.', { status: res.status }))
  const data = await res.json() as { torrents: EngineTorrent[] }
  return data.torrents
}

// --- Seeding ------------------------------------------------------------------

/**
 * Session-wide rate ceilings, bytes/s, `null` for unlimited. Applies to peer
 * traffic only — the HTTP stream mpv reads from is not rate limited — and the
 * engine forgets them on restart, so the store re-applies them.
 */
export async function setLimits(uploadBps: number | null, downloadBps: number | null = null) {
  await fetch(`${ENGINE}/torrents/limits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload_bps: uploadBps, download_bps: downloadBps }),
  }).catch(() => {}) // best effort: an unset limit costs bandwidth, not playback
}

/**
 * How fast we may seed, given the best upload rate ever measured on this line.
 *
 * A line's upload capacity can't be measured without saturating it, and there's
 * no speed test here, so the only honest number is the high-water mark of what
 * we've actually managed — which is only a real measurement while nothing is
 * capping it. Hence `probing`: seeding runs unlimited for a few minutes after
 * launch (never during playback), and what that reaches becomes the estimate.
 *
 * Half of it in the background, a quarter while watching: a saturated uplink
 * delays the ACKs of the stream you're downloading, so it's the one thing that
 * can make buffering worse while looking idle.
 */
export function uploadLimit(peakBps: number, watching: boolean, probing: boolean, override = 0) {
  // A number typed into the settings page is a decision, not an estimate: it
  // wins outright, including over the probe and the playback back-off.
  if (override > 0)
    return override
  if (probing && !watching)
    return null
  // Floors, so a line we've never measured still gives something back.
  return watching
    ? Math.max(32 * 1024, Math.round(peakBps * 0.25))
    : Math.max(64 * 1024, Math.round(peakBps * 0.5))
}

/** `forget` drops the torrent but keeps what's on disk; `delete` removes both. */
export async function torrentAction(id: number, action: 'pause' | 'start' | 'forget' | 'delete') {
  const res = await fetch(`${ENGINE}/torrents/${id}/${action}`, { method: 'POST' })
  if (!res.ok)
    throw new Error($t('Torrent engine said {status}: {reason}', { status: res.status, reason: await res.text() }))
}

export interface Started {
  /** Torrent id in the engine, or -1 for a direct link, which it never sees. */
  id: number
  /** Index of the video file inside the torrent, -1 for a direct link. */
  index: number
  /** What is playing, so the caller can come straight back to this copy. '' for a link. */
  hash: string
  /** Set for a direct link: play this instead of asking the engine for a stream. */
  url: string
  /** The release we picked, or null when the caller named one itself. */
  torrent: Release | null
}

/**
 * What the engine still holds of a torrent played before, if it holds it at
 * all. `ready` means every byte of the wanted file is on disk — that copy plays
 * with no sources, no peers and no network of any kind.
 *
 * `want` is the file the caller named; without one the same guess `startTorrent`
 * makes is made here, since a magnet on its own says nothing about which file
 * inside it anyone means.
 */
async function heldCopy(hash: string, want: number | null, of?: { season?: number, episode?: number }) {
  const held = hash
    ? (await listTorrents().catch(() => [])).find(t => t.info_hash.toLowerCase() === hash.toLowerCase())
    : null
  if (!held)
    return null
  // The list carries per-file progress but not the lengths to compare it to.
  const files = (await torrentDetails(held.id))?.files ?? []
  const index = want ?? pickVideoFile(files, null, of)
  const size = index == null ? 0 : files[index]?.length ?? 0
  const have = index == null ? 0 : held.stats?.file_progress?.[index] ?? 0
  return { id: held.id, hash: held.info_hash, files, index, ready: !!size && have >= size }
}

/**
 * The info hash a magnet names, '' for anything that isn't one. Taken as it is
 * spelled rather than validated: the only thing it is ever compared against is
 * the engine's own list, so a base32 magnet simply matches nothing there and
 * takes the long way round.
 */
function magnetHash(magnet: string) {
  return magnet.match(/xt=urn:btih:([^&]+)/i)?.[1] ?? ''
}

/**
 * Play a copy the engine already holds, without adding anything: every byte of
 * the wanted file is on the disk, so there is nothing to fetch and nobody to
 * ask. This is the whole of what "offline" means here.
 */
async function playHeld(held: NonNullable<Awaited<ReturnType<typeof heldCopy>>>, torrent: Release | null): Promise<Started> {
  // A copy downloaded before the subtitles were ever asked for can still gain
  // them — the engine only fetches a file it was told to, and it will do that
  // when peers turn up. The film plays off the disk meanwhile.
  const missing = pickSubtitleFiles(held.files, held.index!).filter(i => !held.files[i]!.included)
  if (missing.length)
    await limitToFiles(held.id, [...held.files.flatMap((f, i) => f.included ? [i] : []), ...missing])
  return { id: held.id, index: held.index!, hash: held.hash, url: '', torrent }
}

/** Release names and TMDB titles compared on the letters only. */
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim()
}

/**
 * A copy of this title the engine already holds but never filed under it — a
 * pasted magnet, or something downloaded before the title had a `cached` entry.
 * Release names lead with the title, so the name is enough to adopt it, and
 * adopting beats searching sources the user may not even have.
 *
 * Deliberately strict: the title has to end on a word boundary (or "Alien"
 * adopts "Aliens"), a known year has to agree with the one in the release (or
 * one Dune plays as the other), and a pack only counts if it really holds the
 * wanted episode — `pickVideoFile` would otherwise fall back to the largest
 * file and play episode 1.
 */
async function heldByName(name: string, year = '', season = 0, episode = 0) {
  const want = slug(name)
  // Short titles ("Up", "It") match far too much to adopt on a name alone.
  if (want.length < 4)
    return null

  for (const t of await listTorrents().catch(() => [])) {
    const other = slug(t.name ?? '')
    if (other !== want && !other.startsWith(`${want} `))
      continue

    const found = other.slice(want.length).match(/\b(19|20)\d{2}\b/)
    if (year && found && found[0] !== year)
      continue

    if (season && episode) {
      const files = (await torrentDetails(t.id))?.files ?? []
      if (!files.some(f => episodePattern(season, episode).test(f.name)))
        continue
    }
    return t.info_hash
  }
  return null
}

/**
 * Search -> pick -> add -> download only the wanted file. The player streams the
 * result; the download button just leaves it running in the background.
 */
export async function startTorrent(options: {
  /**
   * What to search the sources with, or something that fetches it. A function
   * is only called once a search is really going to happen: a copy already on
   * disk needs no id, and that id is the TMDB round trip a downloaded film
   * would otherwise be held up by.
   */
  imdbId?: string | null | (() => Promise<string | null | undefined>)
  /** Skips the source lookup entirely. */
  magnet?: string
  /** Ditto, for a release that was a direct link rather than a torrent. */
  url?: string
  /**
   * A file on this machine's own disk that the user attached to this title.
   * Beaten by a hand-picked release, since asking for a specific torrent is a
   * decision about *this* play; beats everything else, including a copy in the
   * engine, because it is the copy they said they wanted.
   */
  local?: string
  season?: number
  episode?: number
  /** Play exactly this file — the downloads page already knows which one. */
  fileIndex?: number | null
  /**
   * Title and year as TMDB spells them, read late — the same lookup `imdbId`
   * waits for is what fills it in. Only used to adopt a download the engine
   * already holds but has under no title — see `heldByName`.
   */
  named?: () => { title: string, year?: string } | null | undefined
  /**
   * The copy this title was played from last time. Tried before anything is
   * searched, and the reason a downloaded film starts instantly and offline.
   */
  cached?: { hash: string, file: number } | null
  /** Storage budget for the pick — see `diskBudget`. Ignored with `magnet`. */
  maxBytes?: number
  /**
   * Prefer releases the player can actually decode. Defaults to what this
   * device plays with, so every caller gets it right without knowing about it.
   */
  compatible?: boolean
  onStep?: (step: string) => void
}): Promise<Started> {
  const step = options.onStep ?? (() => {})
  let magnet = options.magnet ?? ''
  let picked: Release | null = null
  let hint: number | null = null

  // Nothing to add, nothing to fetch, nothing to keep — the link is the stream.
  if (options.url)
    return { id: -1, index: -1, hash: '', url: options.url, torrent: null }

  // A file the user already had is the same deal minus the network: no engine,
  // no disk budget, no swarm, and no TMDB round trip on the way in. mpv opens a
  // path exactly as it opens a URL, so nothing downstream needs to know.
  if (options.local && !magnet)
    return { id: -1, index: -1, hash: '', url: options.local, torrent: null }

  // A magnet the caller named is a release someone chose by hand, so it beats
  // whatever is already on the disk. Asked before the id lookup below, because
  // skipping that round trip is the point: a film on the disk plays with TMDB
  // unreachable.
  if (!magnet && options.cached) {
    const { hash, file } = options.cached
    const held = await heldCopy(hash, file)
    // Every byte is here: nothing to search, nobody to ask, nothing to wait for.
    if (held?.ready)
      return playHeld(held, null)
    // Part-way through, the same release still beats searching for another one —
    // a second copy of a film you are half-way through is what that costs.
    if (held) {
      magnet = magnetForHash(hash)
      hint = file
    }
  }

  if (!magnet) {
    const imdbId = typeof options.imdbId === 'function' ? await options.imdbId() : options.imdbId

    // Nothing was filed under this title, but the engine may still be holding it
    // from a pasted magnet or a download the app didn't start. Read after the
    // lookup above, because that is what fills the title in. Adopting beats a
    // search, and is the only thing that works with no sources configured.
    const named = options.named?.()
    const adopted = named?.title
      ? await heldByName(named.title, named.year, options.season, options.episode)
      : null

    if (adopted) {
      magnet = magnetForHash(adopted)
    }
    else {
      if (!imdbId)
        throw new Error($t('TMDB has no IMDb id for this title, so there is nothing to look it up with.'))

      step($t('Searching your sources…'))
      const found = await findReleases(imdbId, options.season, options.episode)
      picked = pickBest(found, options.maxBytes, options.compatible ?? !hasNativePlayer())
      if (!picked) {
        throw new Error(found.length
          ? $t('All {count} releases found were cams, dead, or too big for this device.', { count: found.length })
          : $t('Your sources have nothing for this title.'))
      }
      // The source resolved this one itself — there is no torrent to add.
      if (picked.url)
        return { id: -1, index: -1, hash: '', url: picked.url, torrent: picked }
      magnet = picked.magnet
      hint = picked.fileIdx
    }
  }

  // The engine may already hold whatever we ended up with: the downloads page
  // plays by magnet and never by title, and an adopted download is by definition
  // already there. Re-adding a hash it holds makes librqbit re-open a torrent it
  // is already serving — which is the "fetching metadata" wait a film that
  // finished downloading sat through with every byte of it on the disk.
  const already = await heldCopy(magnetHash(magnet), options.fileIndex ?? hint, options)
  if (already?.ready)
    return playHeld(already, picked)

  step($t('Fetching metadata from peers…'))
  const added = await addTorrent(magnet)
  const files = added.details.files ?? []
  const index = options.fileIndex ?? pickVideoFile(files, hint, options)
  if (index == null)
    throw new Error($t('That torrent holds no video file.'))

  // Adding a magnet the engine already holds hands back its current selection,
  // so a pack you're part-way through keeps downloading what it was told to and
  // gains this file — rather than being reset to it.
  const included = files.flatMap((f, i) => f.included ? [i] : [])
  const narrowed = included.length < files.length
  // The subtitles this release ships come down with the video: a few hundred KB
  // each, and the engine only serves a file it was told to download.
  const wanted = [index, ...pickSubtitleFiles(files, index)]
  const only = narrowed ? [...new Set([...included, ...wanted])] : wanted
  await limitToFiles(added.id, only)
  return { id: added.id, index, hash: added.details.info_hash, url: '', torrent: picked }
}

export function magnetForHash(hash: string) {
  return magnetFor(hash, hash)
}

// --- Disk budget --------------------------------------------------------------
// A watched torrent is a cache, not a library: the engine keeps every byte it
// ever downloaded, and on a 64 GB TV two 4k films fill the device. So the cache
// gets a byte budget (not a torrent count — one 4k remux is thirty episodes)
// and the least recently played torrents are deleted once it's exceeded.

/** Free space that stays free whatever we're doing, so the device keeps working. */
const RESERVE_MIN = 3 * 1024 ** 3
const RESERVE_MAX = 20 * 1024 ** 3

export interface DiskSpace {
  free: number
  total: number
}

/**
 * How many bytes the torrent cache may hold. `used` is what it holds now: the
 * disk's `free` excludes that, and the cache is allowed to reuse its own space.
 * `cap` is the user's own ceiling in bytes, 0 for "whatever the disk allows".
 *
 * An unreadable disk gives no budget at all (Infinity) — never guess a limit
 * and start deleting films off the back of it.
 */
export function diskBudget(disk: DiskSpace | null, used: number, cap = 0) {
  if (!disk?.total)
    return Number.POSITIVE_INFINITY
  const reserve = Math.min(Math.max(disk.total * 0.1, RESERVE_MIN), RESERVE_MAX)
  const room = Math.max(0, disk.free + used - reserve)
  return cap > 0 ? Math.min(cap, room) : room
}

/** All eviction needs of a torrent: what it is, and what it costs on disk. */
type Cached = Pick<EngineTorrent, 'id' | 'info_hash'> & { stats?: { progress_bytes: number } }

export function usedBytes(torrents: Cached[]) {
  return torrents.reduce((n, t) => n + (t.stats?.progress_bytes ?? 0), 0)
}

/**
 * Which torrents to delete to get back under budget. Oldest `touched` first
 * (when it was last played, or first seen), so tonight's episode outlives the
 * film you watched last month. `keep` is what's playing right now.
 *
 * No pinning — everything here is treated as a cache. If someone
 * wants an offline library, that's a "keep" flag on the torrent and one more
 * `filter` below.
 */
export function planEviction(
  torrents: Cached[],
  budget: number,
  keep: number | null,
  touched: Record<string, number>,
) {
  let used = usedBytes(torrents)
  if (used <= budget)
    return []

  const drop: number[] = []
  const oldest = [...torrents].sort((a, b) => (touched[a.info_hash] ?? 0) - (touched[b.info_hash] ?? 0))
  for (const t of oldest) {
    if (used <= budget)
      break
    if (t.id === keep)
      continue
    drop.push(t.id)
    used -= t.stats?.progress_bytes ?? 0
  }
  return drop
}

/**
 * "Only download on Wi-Fi", applied to what is running right now.
 *
 * `running` is every torrent still pulling bytes and `keep` the one being
 * watched — playback is something the user just asked for on this network, so it
 * is never held back; the toggle is about downloads nobody is waiting for.
 *
 * `held` is what earlier calls stopped, and the only thing a return to Wi-Fi
 * starts again: a torrent the *user* paused has to stay paused. It accumulates
 * because a paused torrent drops out of `running` on the very next poll.
 */
export function planNetwork(running: number[], keep: number | null, held: number[], stop: boolean) {
  if (!stop)
    return { pause: [], start: held, held: [] }

  const pause = running.filter(id => id !== keep)
  return { pause, start: [], held: [...new Set([...held, ...pause])] }
}

export function bytesText(n: number) {
  if (!n)
    return '0 B'
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / 1024 ** i).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`
}
