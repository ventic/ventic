// Self-check for the Trakt sync rules: `bun scripts/check-trakt.ts`.
// Two devices disagreeing about an episode is the normal case here, not the
// edge one, and getting the merge wrong either loses a resume point or makes a
// watched episode come back — both of which look like the app forgetting things.
import type { Progress } from '../app/utils/library'
import assert from 'node:assert'
import { ref } from 'vue'
import { playedTitles, titleKey } from '../app/utils/library'
import {
  historyBody,
  listBody,
  listedTitles,
  mergeProgress,
  mergeWatched,
  overLimit,
  playbackTitles,
  playedBody,
  scrobbleAction,
  watchedTitles,
} from '../app/utils/trakt'

const movie = { id: 603, type: 'movie' as const }
const show = { id: 1396, type: 'tv' as const }

// --- Naming a thing ----------------------------------------------------------
// TMDB ids throughout: the app is keyed by them, so nothing is ever matched on
// a title or looked up through IMDb on the way to Trakt.

assert.deepEqual(playedBody(movie), { movie: { ids: { tmdb: 603 } } })
assert.deepEqual(playedBody(show, 2, 3), {
  show: { ids: { tmdb: 1396 } },
  episode: { season: 2, number: 3 },
})
// A series as a whole isn't a thing that can be played, so it is never reported
// as one — a "watched" tick on the show card must not land on some episode.
assert.equal(playedBody(show), null)
assert.equal(playedBody(show, 1, 0), null)
assert.equal(playedBody(show, 0, 1), null)
// Ids arrive from the route as strings often enough to be worth pinning.
assert.deepEqual(playedBody({ id: '603' as unknown as number, type: 'movie' }), { movie: { ids: { tmdb: 603 } } })

// Watchlists hold whole titles; history holds episodes, nested.
assert.deepEqual(listBody(show), { shows: [{ ids: { tmdb: 1396 } }] })
assert.deepEqual(listBody(movie), { movies: [{ ids: { tmdb: 603 } }] })
assert.deepEqual(historyBody([playedBody(movie)!]), { movies: [{ ids: { tmdb: 603 } }], shows: [] })
assert.deepEqual(historyBody([playedBody(show, 2, 3)!]), {
  movies: [],
  shows: [{ ids: { tmdb: 1396 }, seasons: [{ number: 2, episodes: [{ number: 3 }] }] }],
})

// Marking a season is one gesture, so it has to be one request — the whole
// point of batching. Episodes group under their show and season, and a title
// named twice is still named once.
assert.deepEqual(
  historyBody([
    playedBody(show, 1, 2)!,
    playedBody(show, 1, 1)!,
    playedBody(show, 2, 1)!,
    playedBody({ id: 1399, type: 'tv' }, 1, 1)!,
    playedBody(movie)!,
    playedBody(movie)!,
  ]),
  {
    movies: [{ ids: { tmdb: 603 } }],
    shows: [
      {
        ids: { tmdb: 1396 },
        seasons: [
          { number: 1, episodes: [{ number: 2 }, { number: 1 }] },
          { number: 2, episodes: [{ number: 1 }] },
        ],
      },
      { ids: { tmdb: 1399 }, seasons: [{ number: 1, episodes: [{ number: 1 }] }] },
    ],
  },
)
assert.deepEqual(historyBody([]), { movies: [], shows: [] })

// --- Reading what Trakt holds -------------------------------------------------

const watched = watchedTitles(
  [
    { last_watched_at: '2026-01-02T00:00:00.000Z', movie: { ids: { tmdb: 603 } } },
    { last_watched_at: '2026-01-02T00:00:00.000Z', movie: { ids: { tmdb: null } } }, // no TMDB id: unusable
  ],
  [{
    show: { ids: { tmdb: 1396 } },
    seasons: [
      { number: 1, episodes: [{ number: 1, last_watched_at: '2026-01-01T00:00:00.000Z' }] },
      // Season 0 is specials, which this app has no route to and cannot resume.
      { number: 0, episodes: [{ number: 1, last_watched_at: '2026-01-01T00:00:00.000Z' }] },
    ],
  }],
)
assert.deepEqual(watched.map(w => w.key), ['movie:603', 'tv:1396:1:1'])
assert.equal(watched[0]!.at, Date.parse('2026-01-02T00:00:00.000Z'))

const points = playbackTitles([
  { progress: 40, paused_at: '2026-01-03T00:00:00.000Z', type: 'movie', movie: { ids: { tmdb: 603 } } },
  {
    progress: 12.5,
    paused_at: '2026-01-03T00:00:00.000Z',
    type: 'episode',
    show: { ids: { tmdb: 1396 } },
    episode: { season: 2, number: 3 },
  },
  // Nothing to resume from, so nothing to carry over.
  { progress: 0, paused_at: '2026-01-03T00:00:00.000Z', movie: { ids: { tmdb: 11 } } },
])
assert.deepEqual(points.map(p => [p.key, p.percent]), [['movie:603', 40], ['tv:1396:2:3', 12.5]])

assert.deepEqual(
  listedTitles([{ movie: { ids: { tmdb: 603 } } }], [{ show: { ids: { tmdb: 1396 } } }]).map(t => t.key),
  ['movie:603', 'tv:1396'],
)

// --- Merging watched marks ----------------------------------------------------

const HOUR = 3600
const seen = (at: number): Progress => ({ position: HOUR, duration: HOUR, at, watched: true })
const partway = (at: number): Progress => ({ position: 600, duration: HOUR, at, watched: false })

const local = {
  'movie:603': partway(100),
  'movie:999': seen(100),
}
const marks = mergeWatched(local, [
  { key: 'movie:603', at: 500 },
  { key: 'movie:999', at: 500 },
  { key: 'tv:1396:1:1', at: 500 },
])

assert.equal(marks.added, 2, 'the one already watched here needed nothing')
// Watched elsewhere beats half-watched here: not coming up again is the point.
assert.deepEqual(marks.merged['movie:603'], { position: HOUR, duration: HOUR, at: 500, watched: true })
// …but an entry already watched here is left exactly as it was — it carries a
// duration and a position Trakt has never heard of.
assert.deepEqual(marks.merged['movie:999'], local['movie:999'])
// Something never played here has no duration to claim one, and says so.
assert.deepEqual(marks.merged['tv:1396:1:1'], { position: 0, duration: 0, at: 500, watched: true })
assert.deepEqual(local['movie:603'], partway(100), 'the input map is not written through')

// --- Merging resume points ----------------------------------------------------

const resumes = mergeProgress(
  {
    'movie:1': partway(100), // older here than there: take theirs
    'movie:2': partway(900), // newer here: keep ours
    'movie:3': seen(100), // finished here: never walk that back
  },
  [
    { key: 'movie:1', position: 1800, duration: HOUR, at: 500 },
    { key: 'movie:2', position: 1800, duration: HOUR, at: 500 },
    { key: 'movie:3', position: 1800, duration: HOUR, at: 500 },
    { key: 'movie:4', position: 1800, duration: HOUR, at: 500 },
    // No duration resolved for it — a percentage alone is not a place to seek to.
    { key: 'movie:5', position: 0, duration: 0, at: 500 },
  ],
)

assert.equal(resumes.added, 2)
assert.deepEqual(resumes.merged['movie:1'], { position: 1800, duration: HOUR, at: 500, watched: false })
assert.deepEqual(resumes.merged['movie:2'], partway(900))
assert.deepEqual(resumes.merged['movie:3'], seen(100))
assert.deepEqual(resumes.merged['movie:4'], { position: 1800, duration: HOUR, at: 500, watched: false })
assert.equal(resumes.merged['movie:5'], undefined)

// Running the same sync twice must change nothing the second time — this is the
// one that fires on every launch.
const again = mergeProgress(resumes.merged, [{ key: 'movie:1', position: 1800, duration: HOUR, at: 500 }])
assert.equal(again.added, 0)
assert.deepEqual(mergeWatched(marks.merged, [{ key: 'tv:1396:1:1', at: 500 }]).added, 0)

// --- Absorbing and showing are the same set ------------------------------------
// History and Continue watching render from the card-snapshot map and silently
// drop a key that has none, so every title a sync writes into `progress` has to
// be a title it also hydrates. The two are keyed differently — marks come back
// per *episode* (`tv:1396:2:3`), snapshots are per *title* (`tv:1396`) — and it
// is that mismatch that turns a synced episode into a row nobody ever sees.

const pulled = watchedTitles(
  [{ last_watched_at: '2024-03-01T20:00:00Z', movie: { ids: { tmdb: 603 } } }],
  [{
    show: { ids: { tmdb: 1396 } },
    seasons: [{
      number: 2,
      episodes: [
        { number: 3, last_watched_at: '2024-03-02T20:00:00Z' },
        { number: 4, last_watched_at: '2024-03-03T20:00:00Z' },
      ],
    }],
  }],
)

const hydrating = new Set(pulled.map(t => titleKey(t.type, t.id)))
// Two episodes of one show are one title to fetch, not two.
assert.equal(hydrating.size, 2)
for (const title of playedTitles(mergeWatched({}, pulled).merged))
  assert.ok(hydrating.has(title), `${title} absorbed by a sync but never hydrated — it would render as nothing`)

// --- List limits ---------------------------------------------------------------
// Trakt caps its lists per account and this app caps nothing, so being over is
// something the page says, never something a button refuses. The only thing to
// get right is who gets told: nobody at the cap, and nobody without a cap.

assert.equal(overLimit(250, 251), 1)
assert.equal(overLimit(250, 250), 0, 'exactly at the cap is not over it')
assert.equal(overLimit(250, 10), 0)
// 0 is "no sync has asked yet", which must not read as a cap of nothing.
assert.equal(overLimit(0, 900), 0)

// --- Scrobbling --------------------------------------------------------------
// A tick is Trakt's "start": it means "this is playing now", not "play began".

assert.equal(scrobbleAction('tick'), 'start')
assert.equal(scrobbleAction('pause'), 'pause')
assert.equal(scrobbleAction('stop'), 'stop')

// The device-flow cancel guard. A deep `ref` stores a reactive *proxy* of what
// it was given, so `code.value !== mine` is true even when nobody cancelled —
// the poll loop returned before its first request and sign-in hung forever.
const mine = { device_code: 'abc' }
const code = ref<{ device_code: string } | null>(null)
code.value = mine

assert.equal(code.value !== mine, true, 'identity is the trap — if this ever fails, the workaround below is moot')
assert.equal(code.value?.device_code !== mine.device_code, false, 'guard must not fire when nothing changed')
code.value = { device_code: 'xyz' }
assert.equal(code.value?.device_code !== mine.device_code, true, 'guard must fire on a second attempt')
code.value = null
assert.equal(code.value?.device_code !== mine.device_code, true, 'guard must fire on cancel')

console.log('trakt: ok')
