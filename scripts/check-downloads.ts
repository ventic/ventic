// Self-check for what playback does to the other downloads: `bun scripts/check-downloads.ts`.
//
// The one `check:*` that drives a store rather than a pure function, because
// the bug it holds was in the wiring and not in any one rule: closing the
// player paused the torrent it had played even when that was a download
// somebody was waiting on, and everything else stayed paused for the whole
// film. So this is the real `stores/downloads.ts` against a fake engine, with
// Nuxt's auto-imports handed in as globals the way `./i18n-stub` hands in `$t`,
// and its two-second poll run by hand.
import type { Started } from '../app/utils/torrents'
import assert from 'node:assert'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import * as vue from 'vue'
import * as torrents from '../app/utils/torrents'
import './i18n-stub'

/** The store's own intervals, in the order it sets them up — the first is the poll. */
const intervals: Array<() => Promise<void>> = []
const visibility = vue.ref('visible')
const settings = vue.reactive({ playMode: 'auto', downloadDir: '', sources: [], quality: '', wifiOnly: false, keepWatched: true, bufferAhead: 5, bufferBehind: 2, upLimit: 0, downLimit: 0 })

Object.assign(globalThis, vue, torrents, {
  defineStore,
  useLocalStorage: (_key: string, init: unknown) => vue.ref(init),
  useIntervalFn: (fn: () => Promise<void>) => intervals.push(fn),
  useEventListener: () => {},
  useDocumentVisibility: () => visibility,
  useTimeoutFn: () => {},
  meteredNetwork: () => null,
  storageVolumes: () => null,
  useSettingsStore: () => settings,
  useLibraryStore: () => ({ progress: {} }),
})

/** One torrent as the engine would list it: a file of 100 bytes per entry in `file_progress`. */
interface Fake { id: number, state: string, finished: boolean, file_progress: number[] }
const engine = new Map<number, Fake>()

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input)
  const action = url.match(/\/torrents\/(\d+)\/(pause|start|delete)$/)
  if (action) {
    const t = engine.get(Number(action[1]))
    if (!t)
      return new Response('no such torrent', { status: 404 })
    if (action[2] === 'delete')
      engine.delete(t.id)
    else
      t.state = action[2] === 'pause' ? 'paused' : 'live'
    return Response.json({})
  }
  if (url.includes('/torrents?with_stats')) {
    return Response.json({
      torrents: [...engine.values()].map(t => ({
        id: t.id,
        info_hash: `hash${t.id}`,
        name: `torrent ${t.id}`,
        output_folder: '/downloads',
        stats: { state: t.state, error: null, finished: t.finished, progress_bytes: 0, total_bytes: 1, file_progress: t.file_progress, live: null },
      })),
    })
  }
  return Response.json({})
}) as typeof fetch

setActivePinia(createPinia())
const { useDownloadsStore } = await import('../app/stores/downloads')
const downloads = useDownloadsStore()

const poll = () => intervals[0]!()
const states = () => Object.fromEntries([...engine.values()].map(t => [t.id, t.state]))
/** A fresh engine holding these torrents, all downloading unless told otherwise. */
async function holding(...list: Array<number | Partial<Fake> & { id: number }>) {
  engine.clear()
  for (const t of list)
    engine.set(typeof t === 'number' ? t : t.id, { state: 'live', finished: false, file_progress: [0], ...typeof t === 'number' ? { id: t } : t })
  await poll()
}
/** What `watch.vue` hands `focus` once `startTorrent` has answered. */
function play(id: number, o: Partial<Started> = {}) {
  return downloads.focus({ id, index: 0, length: 100, url: '', running: false, hash: '', torrent: null, stream: false, ...o })
}
function arrive(id: number, file_progress: number[], finished = false) {
  Object.assign(engine.get(id)!, { file_progress, finished })
}

// --- Holding the downlink until the film is on the disk -----------------------

await holding(1, 2, 3)
await play(3)
assert.deepEqual(states(), { 1: 'paused', 2: 'paused', 3: 'live' }, 'the film gets the whole pipe')
await poll()
assert.deepEqual(states(), { 1: 'paused', 2: 'paused', 3: 'live' }, 'for as long as it is still arriving')
arrive(3, [100], true)
await poll()
assert.deepEqual(states(), { 1: 'live', 2: 'live', 3: 'live' }, 'and hands it back the moment it is on the disk, mid-film')
await downloads.release()
assert.deepEqual(states(), { 1: 'live', 2: 'live', 3: 'live' }, 'a finished film seeds on')

// Nothing to hold the pipe for at all: a finished episode in a pack that is
// still downloading, and a file of the user's own.
await holding(1, { id: 4, file_progress: [100, 0] })
await play(4, { running: true })
assert.deepEqual(states(), { 1: 'live', 4: 'live' }, 'a file already on the disk pauses nothing')
await downloads.release()
assert.deepEqual(states(), { 1: 'live', 4: 'live' }, 'nor is its pack paused on the way out')

await holding(1)
await play(-1, { url: '/films/Their.Own.Film.mkv', length: 0 })
assert.deepEqual(states(), { 1: 'live' }, 'a local file needs no network')
await downloads.release()

// A link can't be seen arriving, so it is the network for as long as it plays.
await holding(1, 2)
await play(-1, { url: 'https://debrid.example/film.mkv', length: 0 })
await poll()
assert.deepEqual(states(), { 1: 'paused', 2: 'paused' }, 'a link holds the pipe the whole time')
await downloads.release()
assert.deepEqual(states(), { 1: 'live', 2: 'live' }, 'and gives it back on the way out')

// --- Leaving the player -------------------------------------------------------

await holding(1, 2, 3)
await play(3)
await downloads.release()
assert.deepEqual(states(), { 1: 'live', 2: 'live', 3: 'paused' }, 'what the play started stops with it')

// The reported bug: playing one of the downloads themselves.
await holding(1, 2)
await play(1, { running: true })
await poll()
assert.deepEqual(states(), { 1: 'live', 2: 'paused' }, 'the download being watched keeps going')
await downloads.release()
assert.deepEqual(states(), { 1: 'live', 2: 'live' }, 'and closing the player leaves both downloading')

// --- On to the next episode ---------------------------------------------------

await holding(2, { id: 5, file_progress: [0, 0] })
await play(5, { running: true })
arrive(5, [100, 0])
await poll()
assert.deepEqual(states(), { 2: 'live', 5: 'live' }, 'episode 1 on the disk: the pipe is handed back')
await play(5, { index: 1, running: true })
assert.deepEqual(states(), { 2: 'paused', 5: 'live' }, 'episode 2 is still arriving: held again')
await downloads.release()
assert.deepEqual(states(), { 2: 'live', 5: 'live' }, 'and the pack keeps downloading after the player closes')

// Next episode — or Try again — while the first is still arriving: the hold
// carries on, and must not lose what it paused.
await holding(2, { id: 5, file_progress: [0, 0] })
await play(5, { running: true })
await play(5, { index: 1, running: true })
await poll()
assert.deepEqual(states(), { 2: 'paused', 5: 'live' }, 'still held for episode 2')
await downloads.release()
assert.deepEqual(states(), { 2: 'live', 5: 'live' }, 'and what it paused for episode 1 comes back')

// A pack only Play ever started stops again, however it reports itself by the
// second episode — `startTorrent` sees it running then, because Play started it.
await holding({ id: 5, file_progress: [0, 0] })
await play(5)
await play(5, { index: 1, running: true })
await downloads.release()
assert.deepEqual(states(), { 5: 'paused' }, 'what it was before the first episode is what it goes back to')

// The next episode in a torrent the last film held back: `startTorrent` found it
// paused, but only because playback paused it.
await holding(1, 6)
await play(6)
engine.get(1)!.state = 'live' // started by `startTorrent` for the play
await play(1)
await downloads.release()
assert.deepEqual(states(), { 1: 'live', 6: 'paused' }, 'running until the last film paused it, so it goes on running')

// Arriving with the window hidden: the poll is what hands the pipe back.
await holding(1, 3)
await play(3)
await poll()
arrive(3, [100], true)
visibility.value = 'hidden'
await poll()
assert.deepEqual(states(), { 1: 'live', 3: 'live' }, 'handed back with nobody looking')
visibility.value = 'visible'
await downloads.release()

console.log('downloads: ok')
