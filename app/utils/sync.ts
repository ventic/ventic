/**
 * Keeping a library in step across two screens, with no server of ours in the
 * middle.
 *
 * The file is already written: `backup.ts` turns every `ventic.` key into one
 * JSON object and back. Syncing is that same object left somewhere both devices
 * can reach, fetched before it is written, and **merged** rather than assigned —
 * which is the whole difference between this and the backup beside it. A
 * restore is "this file wins"; a sync is two devices that were both used.
 *
 * **Where it goes is the user's, not ours.** A plain HTTP PUT and GET against an
 * address they type is the entire transport: that is WebDAV, which is what a
 * Nextcloud, an ownCloud, a NAS, a hosted drive or a `rclone serve` hands out,
 * and it needs no OAuth client to register, no review to pass and no account
 * with us. The same line the source list holds: the app ships with no address
 * and suggests none. Dropbox and Google Drive are neither harder nor cheaper —
 * they are an OAuth app registration and a scope review, which is a decision to
 * make and not a function to write, and the day one exists it is a second
 * `pull`/`push` pair under the same merge.
 *
 * ponytail: a poll and a file, not a protocol. Two devices and a five-minute
 * tick don't need a change feed; per-entry timestamps and a tombstone list are
 * what make the merge converge, and both were already in the data.
 *
 * Pure functions over plain objects, so `bun run check:sync` exercises the merge
 * without a browser or a server.
 */
import type { Backup } from './backup'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { readBackup } from './backup'

const PREFIX = 'ventic.'

/** What a device syncs, one switch each. */
export type GroupKey = 'library' | 'sources' | 'preferences'
export type Groups = Record<GroupKey, boolean>

/**
 * Preferences are off, and deliberately: a subtitle size that suits a laptop is
 * the wrong one across a living room, and a theme picked for a phone is not the
 * one a television wants. What you watched is the same everywhere, so that is
 * what is on.
 */
export const GROUP_DEFAULTS: Groups = { library: true, sources: true, preferences: false }

/**
 * Never leaves the device it was written on, whatever is switched on. These name
 * this* machine — a path on its disk, an info hash of a file it holds, the
 * colour behind its own boot screen, the name it answers a cast by. Carried to
 * another screen they are at best meaningless and at worst point at nothing.
 *
 * Credentials don't need listing: `makeBackup` drops the SECRET set before this
 * file ever sees a key, which is also why the sync's own settings can't sync.
 */
const NEVER = new Set(['cached', 'local', 'downloadDir', 'touched', 'peakUpload', 'ground', 'updateSkipped', 'castReceive', 'castName', 'sync'])

/** Watch state — the reason anybody asked for this. */
const LIBRARY = new Set(['media', 'progress', 'favourites', 'watchlist', 'liveFavourites', 'deleted'])

/**
 * Maps whose entries carry their own timestamp, so two libraries merge entry by
 * entry rather than one of them winning whole. The name is the key's suffix, and
 * `library.ts` writes its tombstones under exactly these — see `forget` there.
 */
const TIMED = new Set(['progress', 'favourites', 'watchlist', 'liveFavourites'])

/** Deletions this device knows about, `<map>:<entry>` -> when. */
export const DELETED = `${PREFIX}deleted`
/** Poster and title snapshots. Added to, never individually removed. */
export const MEDIA = `${PREFIX}media`

/**
 * How long a deletion is remembered. Long enough for a television switched on
 * once a month to hear about it, short enough that the list doesn't grow for
 * ever.
 */
export const TOMBSTONE_LIFE = 90 * 24 * 3600 * 1000

export interface SyncConfig {
  /** A folder or a file on a WebDAV server. Empty means syncing is off. */
  url: string
  user: string
  pass: string
  groups: Groups
  /** Last successful sync, ms since epoch. 0 for never. */
  at: number
  /**
   * The single-value keys this device and the file last agreed on. Without it a
   * three-way merge is a two-way guess, and a preference changed on one screen
   * can't be told from one changed on the other.
   */
  base: Record<string, string>
}

export const SYNC_DEFAULTS: SyncConfig = { url: '', user: '', pass: '', groups: { ...GROUP_DEFAULTS }, at: 0, base: {} }

/** The settings grid, in the order it lists them. Functions for the same reason `SECTIONS` uses them. */
export const SYNC_GROUPS: { key: GroupKey, title: () => string, hint: () => string }[] = [
  {
    key: 'library',
    title: () => $t('Watch history'),
    hint: () => $t('What you have watched, how far you got, favourites, the watchlist and starred channels.'),
  },
  {
    key: 'sources',
    title: () => $t('Sources'),
    hint: () => $t('The servers Ventic searches, so a new screen can find something to play without adding them again.'),
  },
  {
    key: 'preferences',
    title: () => $t('Preferences'),
    hint: () => $t('Theme, layout, subtitle and audio settings, speed limits. Off by default: subtitles sized for a laptop are the wrong size across a room.'),
  },
]

/** Which switch a key answers to, or null for one that never travels. */
export function groupOf(key: string): GroupKey | null {
  if (!key.startsWith(PREFIX))
    return null
  const name = key.slice(PREFIX.length)
  if (NEVER.has(name))
    return null
  if (LIBRARY.has(name))
    return 'library'
  if (name === 'sources')
    return 'sources'
  return 'preferences'
}

// --- Merging -----------------------------------------------------------------

function json<T>(text: string | undefined, fallback: T): T {
  try {
    const value = JSON.parse(text ?? 'null')
    return value && typeof value === 'object' ? value as T : fallback
  }
  catch {
    return fallback
  }
}

/**
 * When an entry was written. A list holds the timestamp itself, a progress row
 * holds it in `at` — one function covers both, and 0 means "no idea", which only
 * ever loses a tie.
 */
function stamp(value: unknown) {
  return typeof value === 'number' ? value : Number((value as { at?: number } | undefined)?.at) || 0
}

/** Deletions from both sides, the later one winning, with the expired ones dropped. */
export function pruneDeleted(tombs: Record<string, number>, now = Date.now()) {
  return Object.fromEntries(Object.entries(tombs).filter(([, at]) => now - at < TOMBSTONE_LIFE))
}

function mergeDeleted(mine: Record<string, number>, theirs: Record<string, number>, now = Date.now()) {
  const out = { ...mine }
  for (const [key, at] of Object.entries(theirs)) {
    if (at > (out[key] ?? 0))
      out[key] = at
  }
  return pruneDeleted(out, now)
}

/**
 * Two copies of one keyed map. The newer entry wins, and an entry a deletion
 * outlives is dropped from both sides — without that last part, unfavouriting a
 * film on the laptop means the television hands it straight back, and then keeps
 * handing it back for ever. Playing it again writes a fresher stamp than the
 * tombstone, which is what makes a re-watch survive.
 */
function mergeMap(name: string, mine: Record<string, unknown>, theirs: Record<string, unknown>, tombs: Record<string, number>) {
  const out = { ...mine }
  for (const [key, value] of Object.entries(theirs)) {
    if (!(key in out) || stamp(value) > stamp(out[key]))
      out[key] = value
  }
  for (const key of Object.keys(out)) {
    const gone = tombs[`${name}:${key}`] ?? 0
    if (gone && stamp(out[key]) <= gone)
      delete out[key]
  }
  return out
}

/**
 * One value, three copies: this device's, the file's, and what the two last
 * agreed on. Only one side moved, that side wins. Both moved and the *file*
 * wins — not because it is righter, but because it converges: the other device
 * already holds that value and will stop pushing, where "mine always wins"
 * leaves two screens shoving their own version back and forth for ever.
 */
function threeWay(mine: string | undefined, theirs: string | undefined, was: string | undefined) {
  if (theirs === undefined)
    return mine
  if (mine === undefined || mine === theirs)
    return theirs
  return theirs === was ? mine : theirs
}

export interface Merge {
  /** What this device writes back into its own storage. */
  local: Record<string, string>
  /** The whole file to send back up. */
  remote: Record<string, string>
}

/**
 * The merge, over the raw key/value pairs `makeBackup` produces.
 *
 * A group this device has switched off is not read *and not written*: the file
 * keeps whatever another device put there. Otherwise a laptop with Preferences
 * off would quietly wipe the preferences two other screens are syncing.
 */
export function mergeKeys(
  local: Record<string, string>,
  remote: Record<string, string>,
  base: Record<string, string>,
  groups: Groups,
  now = Date.now(),
): Merge {
  const tombs = mergeDeleted(json(local[DELETED], {}), json(remote[DELETED], {}), now)
  const merged: Record<string, string> = {}

  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const group = groupOf(key)
    if (!group || !(groups[group] ?? GROUP_DEFAULTS[group]))
      continue

    const name = key.slice(PREFIX.length)
    if (key === DELETED) {
      merged[key] = JSON.stringify(tombs)
    }
    // Snapshots of artwork, not state: added to and never individually removed,
    // so a union is the whole merge. An orphan costs a few hundred bytes and is
    // never rendered — nothing lists a title the other three maps have dropped.
    else if (key === MEDIA) {
      merged[key] = JSON.stringify({ ...json(remote[key], {}), ...json(local[key], {}) })
    }
    else if (TIMED.has(name)) {
      merged[key] = JSON.stringify(mergeMap(name, json(local[key], {}), json(remote[key], {}), tombs))
    }
    else {
      const value = threeWay(local[key], remote[key], base[key])
      if (value !== undefined)
        merged[key] = value
    }
  }

  return { local: merged, remote: { ...remote, ...merged } }
}

/**
 * The single-value half of a payload — what the next three-way merge compares
 * against. The maps are left out: they merge entry by entry and have no use for
 * a base, and `media` alone would double what the library costs in storage.
 */
export function baseOf(keys: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(keys).filter(([key]) => key !== DELETED && key !== MEDIA && !TIMED.has(key.slice(PREFIX.length))),
  )
}

// --- The remote --------------------------------------------------------------

const FILE = 'ventic-sync.json'

/** A folder gets the filename appended; a URL that already names one is left alone. */
export function target(url: string) {
  const clean = url.trim().replace(/\/+$/, '')
  return clean.endsWith('.json') ? clean : `${clean}/${FILE}`
}

function headers(config: SyncConfig): Record<string, string> {
  if (!config.user)
    return {}
  // btoa only speaks Latin-1, and a password is exactly where a character
  // outside it turns up.
  const bytes = new TextEncoder().encode(`${config.user}:${config.pass}`)
  return { Authorization: `Basic ${btoa(String.fromCharCode(...bytes))}` }
}

/**
 * Through Rust, not the webview: somebody's own server sends no
 * `Access-Control-Allow-Origin`, and a `tauri://` origin is bound by CORS like
 * any other page — the same reason utils/iptv.ts fetches the way it does.
 * `bun run dev` has no Rust under it and only reaches a server that does send
 * the header.
 */
function request(url: string, init: RequestInit) {
  const f = '__TAURI_INTERNALS__' in globalThis ? tauriFetch : globalThis.fetch
  return f(url, { ...init, signal: AbortSignal.timeout(30_000) })
}

/** A sentence for the settings page, because "500" is not one. */
export function problem(status: number) {
  if (status === 401 || status === 403)
    return $t('That server refused the username and password.')
  if (status === 404 || status === 409)
    return $t('There is no folder at that address.')
  if (status === 507)
    return $t('That storage is full.')
  return $t('The server answered {status}.', { status })
}

/** What is up there now, or null when nothing has been written yet. */
export async function pull(config: SyncConfig): Promise<Backup | null> {
  const res = await request(target(config.url), { headers: headers(config) })
  // The first sync of a fresh folder, not a failure.
  if (res.status === 404 || res.status === 410)
    return null
  if (!res.ok)
    throw new Error(problem(res.status))
  const text = await res.text()
  return text.trim() ? readBackup(text) : null
}

export async function push(config: SyncConfig, text: string) {
  const res = await request(target(config.url), {
    method: 'PUT',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: text,
  })
  if (!res.ok)
    throw new Error(problem(res.status))
}
