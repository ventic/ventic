/**
 * The library in one file.
 *
 * Everything the app remembers — what you have watched, how far, favourites and
 * the watchlist, the sources you added, every preference on the settings page — lives in
 * localStorage. That is one cleared webview away from gone, and it does not
 * travel between a laptop and a TV box on its own. So the file: write one, carry
 * it over, read it back. `utils/sync.ts` is the same object left somewhere both
 * devices can reach — it is built here, and *merged* there rather than applied.
 *
 * Pure functions over a storage-shaped object, so `bun run check:library`
 * exercises them without a browser; the file dialogs live in settings/Account.vue.
 *
 * Every `ventic.` key, verbatim, rather than a schema per store. A
 * preference added tomorrow is in the backup the day it is written, and a key
 * that stops existing is simply never read again. The day two builds disagree
 * about what a key *means*, `version` is what a migration hangs off.
 */

const PREFIX = 'ventic.'

/**
 * Ours, but never written to a file. A backup is meant to be copied onto a USB
 * stick and mailed to yourself; a token in one is a credential you can't take
 * back once the file has been anywhere. Any key holding one goes here.
 *
 * `ventic.trakt` held an OAuth token in versions that had a Trakt sign-in. The
 * sync is gone but the key is still sitting in those installs' storage, so it
 * stays on this list rather than starting to land in backup files.
 *
 * `ventic.sync` holds the password to somebody's own drive, and is what stops
 * the sync in `utils/sync.ts` from ever syncing its own credentials outward:
 * this set is dropped before that file sees a key at all.
 */
const SECRET = new Set([`${PREFIX}trakt`, `${PREFIX}tmdbKey`, `${PREFIX}playlists`, `${PREFIX}castCode`, `${PREFIX}castTarget`, `${PREFIX}sync`])

export interface Backup {
  app: 'ventic'
  /** The layout of this file, not the app's version. */
  version: 1
  /** Written at, ms since epoch — the only way to tell two backups apart. */
  at: number
  /** Raw localStorage entries: the key as stored, the value still JSON text. */
  keys: Record<string, string>
}

/** As much of `localStorage` as this file needs, so it can be handed a plain object in a test. */
export interface KeyStore {
  readonly length: number
  key: (index: number) => string | null
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function makeBackup(store: KeyStore, at = Date.now()): Backup {
  const keys: Record<string, string> = {}
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    // Other things share this origin — Vuetify's theme cache, whatever a
    // devtool left behind. Ours are the only ones we can promise to restore.
    if (key?.startsWith(PREFIX) && !SECRET.has(key))
      keys[key] = store.getItem(key) ?? ''
  }
  return { app: 'ventic', version: 1, at, keys }
}

/**
 * Vet a file someone handed us before any of it reaches storage. Throws with a
 * sentence the settings page can show as-is.
 */
export function readBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  }
  catch {
    return fail($t('That file isn\'t JSON, so it isn\'t a backup.'))
  }

  const b = raw as Partial<Backup> | null
  if (!b || typeof b !== 'object' || b.app !== 'ventic' || !b.keys || typeof b.keys !== 'object')
    return fail($t('That isn\'t a Ventic backup.'))
  if (b.version !== 1)
    return fail($t('That backup is in format {version}, which this build doesn\'t know how to read.', { version: b.version }))

  // A backup is a file, and a file can come from anywhere. Nothing outside our
  // own prefix is written back, whatever the file asks for — and nothing a
  // backup has no business carrying is accepted just because it carries it.
  const keys = Object.fromEntries(
    Object.entries(b.keys)
      .filter(([key, value]) => key.startsWith(PREFIX) && !SECRET.has(key) && typeof value === 'string'),
  )
  if (!Object.keys(keys).length)
    return fail($t('That backup is empty.'))

  return { app: 'ventic', version: 1, at: Number(b.at) || 0, keys }
}

function fail(message: string): never {
  throw new Error(message)
}

function entries(value?: string): unknown[] {
  try {
    const parsed = JSON.parse(value ?? 'null')
    return Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.keys(parsed) : []
  }
  catch {
    return []
  }
}

/**
 * What restoring this file would bring back, for the confirmation dialog —
 * replacing a library is not something to do on a filename alone.
 */
export function backupSummary(b: Backup) {
  return {
    titles: entries(b.keys[`${PREFIX}media`]).length,
    watched: entries(b.keys[`${PREFIX}progress`]).length,
    favourites: entries(b.keys[`${PREFIX}favourites`]).length,
    watchlist: entries(b.keys[`${PREFIX}watchlist`]).length,
    sources: entries(b.keys[`${PREFIX}sources`]).length,
    settings: Object.keys(b.keys).length,
  }
}

/**
 * Write the lot back. Assignment, not a merge: half of one library and half of
 * another is a state neither device was ever in, and "restore" should mean what
 * it says. Keys the file doesn't mention are left alone — a newer build's
 * preferences survive restoring an older backup.
 *
 * The caller reloads afterwards: every store reads its ref from localStorage
 * once, at setup, and nothing in the page is watching for a write from itself.
 */
export function applyBackup(b: Backup, store: KeyStore) {
  for (const [key, value] of Object.entries(b.keys))
    store.setItem(key, value)
}
