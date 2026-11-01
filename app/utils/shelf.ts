/**
 * What has to outlive a launch and stay out of backup files: subtitle files, the
 * one chosen for each episode, and — for titles downloaded to watch without a
 * network — their TMDB pages and pictures. IndexedDB rather than localStorage,
 * which is a few MB for the whole app and goes into every backup and the sync.
 * Where there is none (the check scripts) or it fails, nothing is kept and
 * nothing breaks.
 *
 * ponytail: never pruned. A subtitle is ~100 KB and a title's pages and pictures
 * a few hundred — a thousand of either is a few hundred MB. Drop the oldest when
 * a TV box's few GB make that matter.
 */
import { ref, shallowReactive } from 'vue'

const SHELVES = ['files', 'chosen', 'tmdb', 'images'] as const
export type Shelf = typeof SHELVES[number]

let db: Promise<IDBDatabase> | undefined

export function onShelf<T>(shelf: Shelf, mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (!globalThis.indexedDB)
    return Promise.resolve(undefined)
  db ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('ventic-offline', 1)
    open.onupgradeneeded = () => SHELVES.forEach(name => open.result.createObjectStore(name))
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  return db.then(d => new Promise<T | undefined>(resolve => {
    const request = use(d.transaction(shelf, mode).objectStore(shelf))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(undefined)
  })).catch(() => undefined)
}

export function shelved<T>(shelf: Shelf, key: string) {
  return onShelf<T>(shelf, 'readonly', store => store.get(key))
}

export function shelve(shelf: Shelf, key: string, value: unknown) {
  return onShelf(shelf, 'readwrite', store => store.put(value, key))
}

/**
 * Whether the device says it has a network — `navigator.onLine`, kept current.
 * It can say yes on a Wi-Fi with no way out; offline mode is for the plane and
 * the train, where it says no.
 */
export const online = ref(globalThis.navigator?.onLine ?? true)
globalThis.addEventListener?.('online', () => (online.value = true))
globalThis.addEventListener?.('offline', () => (online.value = false))

/**
 * Whether a title's TMDB pages are kept for offline, by `type:id` — the
 * downloads store's to answer (`keeps`), which it registers here so `tmdb`
 * can ask without importing a store that imports it.
 */
export const offlineTitles = { keeps: (_title: string) => false }

/** Saved pictures, TMDB image path -> object URL. What `posterUrl` and the rest hand out first. */
export const images = shallowReactive(new Map<string, string>())

/** Every saved picture to hand, once at startup — the URL helpers can't wait on a database. */
export async function loadImages() {
  const [paths, blobs] = await Promise.all([
    onShelf<IDBValidKey[]>('images', 'readonly', store => store.getAllKeys()),
    onShelf<Blob[]>('images', 'readonly', store => store.getAll()),
  ])
  paths?.forEach((path, i) => blobs?.[i] && !images.has(String(path)) && images.set(String(path), URL.createObjectURL(blobs[i]!)))
}

/** Save one picture under its TMDB path, whatever size it was fetched at. */
export async function keepImage(path: string, url: string, get: typeof fetch = fetch) {
  if (images.has(path))
    return
  const res = await get(url).catch(() => null)
  if (!res?.ok)
    return
  const blob = await res.blob()
  await shelve('images', path, blob)
  images.set(path, URL.createObjectURL(blob))
}
