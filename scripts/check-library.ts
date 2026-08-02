// Self-check for the watch-state rules: `bun scripts/check-library.ts`.
// These decide whether something is marked watched and which episode comes up
// next — get them wrong and the app either forgets what you saw or skips it.
import type { KeyStore } from '../app/utils/backup'
import assert from 'node:assert'
import { applyBackup, backupSummary, makeBackup, readBackup } from '../app/utils/backup'
import { continuing, finished, fraction, nextEpisode, parseKey, placeholder, playedTitles, progressKey, remainingText, resumable, showEntries, slim, UNKNOWN_TITLE } from '../app/utils/library'
import { mediaLink } from '../app/utils/tmdb'

const HOUR = 3600

// --- Keys --------------------------------------------------------------------

assert.equal(progressKey('movie', 603), 'movie:603')
assert.equal(progressKey('tv', 1396, 2, 3), 'tv:1396:2:3')
// A show with no episode is the show itself — what a manual "watched" mark hangs on.
assert.equal(progressKey('tv', 1396), 'tv:1396')
// Season 0 is specials, and the app never routes to them; either half missing
// means "the whole title".
assert.equal(progressKey('tv', 1396, 0, 3), 'tv:1396')
assert.equal(progressKey('tv', 1396, 2, 0), 'tv:1396')

assert.deepEqual(parseKey('movie:603'), { type: 'movie', id: 603, season: 0, episode: 0, title: 'movie:603' })
assert.deepEqual(parseKey('tv:1396:2:3'), { type: 'tv', id: 1396, season: 2, episode: 3, title: 'tv:1396' })

// --- The credits buffer ------------------------------------------------------

// The whole point: quitting during the credits still counts as having seen it.
assert.ok(finished(HOUR * 1.8, HOUR * 2), 'a 2h film at 1h48 is watched')
assert.ok(!finished(HOUR * 1.7, HOUR * 2), 'a 2h film at 1h42 is not')
assert.ok(finished(19 * 60, 20 * 60), 'a 20m episode with 1m left is watched')
assert.ok(finished(HOUR, HOUR), 'played right out')
// No duration means mpv never reported one; nothing can be concluded from that.
assert.ok(!finished(HOUR, 0))
assert.ok(!finished(0, 0))

// --- Resuming ----------------------------------------------------------------

assert.ok(resumable(HOUR, HOUR * 2), 'halfway through')
assert.ok(!resumable(30, HOUR * 2), 'half a minute in is not worth an offer')
assert.ok(!resumable(HOUR * 1.9, HOUR * 2), 'past the watched mark, so there is nothing to resume')
assert.ok(!resumable(0, HOUR))

assert.equal(fraction({ position: HOUR, duration: HOUR * 2, at: 0, watched: false }), 0.5)
// A hand-marked title has no position, and a half-empty bar would look like a lie.
assert.equal(fraction({ position: 0, duration: 0, at: 0, watched: true }), 1)
assert.equal(fraction(undefined), 0)
// Clamped: mpv can report a position past a duration it revised down mid-file.
assert.equal(fraction({ position: HOUR * 3, duration: HOUR, at: 0, watched: false }), 1)

assert.equal(remainingText({ position: HOUR, duration: HOUR * 2, at: 0, watched: false }), '1h 0m left')
assert.equal(remainingText({ position: 0, duration: 0, at: 0, watched: false }), '')
assert.equal(remainingText({ position: HOUR, duration: HOUR, at: 0, watched: true }), '')

// --- What to play next -------------------------------------------------------

const seasons = [
  { number: 1, episodes: 7 },
  { number: 2, episodes: 13 },
  { number: 3, episodes: 13 },
]

assert.deepEqual(nextEpisode(seasons, null), { season: 1, episode: 1 }, 'never watched: start at the start')
assert.deepEqual(nextEpisode([], null), null, 'a show TMDB lists no seasons for')

assert.deepEqual(
  nextEpisode(seasons, { season: 2, episode: 3, watched: true }),
  { season: 2, episode: 4 },
  'finished S2E3, so S2E4 is next',
)
assert.deepEqual(
  nextEpisode(seasons, { season: 2, episode: 3, watched: false }),
  { season: 2, episode: 3 },
  'left part-way through: pick that one back up, do not skip it',
)
assert.deepEqual(
  nextEpisode(seasons, { season: 1, episode: 7, watched: true }),
  { season: 2, episode: 1 },
  'the end of a season rolls into the next one',
)
assert.deepEqual(
  nextEpisode(seasons, { season: 3, episode: 13, watched: true }),
  null,
  'the finale has nothing after it',
)
// Seasons TMDB numbers with a gap (a show that skips one, or specials filtered
// out) still has to roll over to whatever is actually next.
assert.deepEqual(
  nextEpisode([{ number: 1, episodes: 2 }, { number: 4, episodes: 6 }], { season: 1, episode: 2, watched: true }),
  { season: 4, episode: 1 },
)
// An episode number TMDB doesn't list any more (a re-cut season) must not
// silently vanish — it moves on rather than sticking.
assert.deepEqual(
  nextEpisode(seasons, { season: 9, episode: 1, watched: true }),
  null,
)

// --- The rows built out of all that -------------------------------------------

function entry(position: number, duration: number, at: number, watched = false) {
  return { position, duration, at, watched }
}

const stored = {
  // Two episodes of one show, plus the movie and a show finished last month.
  'tv:1396:2:2': entry(HOUR, HOUR, 300, true),
  'tv:1396:2:3': entry(600, HOUR, 500),
  'movie:603': entry(HOUR, HOUR * 2, 400),
  'movie:27205': entry(HOUR * 2, HOUR * 2, 100, true),
  'tv:1399:1:1': entry(30, HOUR, 200),
}

assert.deepEqual(
  showEntries(stored, 1396).map(([key]) => key),
  ['tv:1396:2:3', 'tv:1396:2:2'],
  'the show\'s own episodes only, most recent first',
)
assert.deepEqual(showEntries(stored, 13).map(([key]) => key), [], 'a prefix must not match 1396')

// "Mark the earlier ones watched too" writes them all in one tick, so the tie
// has to break on the episode itself — this is what the show page resumes from.
const batch = {
  'tv:1396:1:1': entry(0, 0, 500, true),
  'tv:1396:1:2': entry(0, 0, 500, true),
  'tv:1396:2:1': entry(0, 0, 500, true),
}
assert.deepEqual(
  showEntries(batch, 1396).map(([key]) => key),
  ['tv:1396:2:1', 'tv:1396:1:2', 'tv:1396:1:1'],
  'same millisecond: the latest episode still comes first',
)

assert.deepEqual(
  continuing(stored).map(e => e.key),
  ['tv:1396:2:3', 'movie:603'],
  'part-way through only: the finished ones and the 30-second start are out',
)
assert.deepEqual(
  continuing(stored)[0],
  { key: 'tv:1396:2:3', title: 'tv:1396', season: 2, episode: 3, progress: stored['tv:1396:2:3'] },
)
// Six episodes into a show is one thing to carry on with, not six.
assert.equal(
  continuing({ ...stored, 'tv:1396:2:4': entry(600, HOUR, 100) }).filter(e => e.title === 'tv:1396').length,
  1,
)

assert.deepEqual(
  playedTitles(stored),
  ['tv:1396', 'movie:603', 'tv:1399', 'movie:27205'],
  'one row per title, ordered by its most recent episode',
)
assert.deepEqual(playedTitles({}), [])

// --- Snapshots ---------------------------------------------------------------

// Detail responses carry cast, crew and images; every one of those would
// otherwise be copied into localStorage and kept there forever.
const detail = {
  id: 1396,
  type: 'tv' as const,
  title: 'Breaking Bad',
  year: '2008',
  poster: '/p.jpg',
  backdrop: '/b.jpg',
  overview: 'x',
  rating: 8.9,
  genreIds: [18],
  cast: Array.from({ length: 20 }, (_, i) => ({ id: i })),
  seasons: [{ number: 1 }],
}
assert.deepEqual(Object.keys(slim(detail as never)).sort(), [
  'backdrop',
  'genreIds',
  'id',
  'overview',
  'poster',
  'rating',
  'title',
  'type',
  'year',
])

// --- Backup ------------------------------------------------------------------
// The file is the only copy of a library that ever leaves the device, so it has
// to round-trip exactly — and it has to be safe to read one from anywhere.

/** localStorage, minus the parts `utils/backup` doesn't touch. */
function fakeStore(seed: Record<string, string> = {}): KeyStore & { data: Record<string, string> } {
  const data = { ...seed }
  return {
    data,
    get length() {
      return Object.keys(data).length
    },
    key: i => Object.keys(data)[i] ?? null,
    getItem: k => data[k] ?? null,
    setItem: (k, v) => (data[k] = v),
  }
}

const live = fakeStore({
  'ventic.media': JSON.stringify({ 'movie:603': { title: 'The Matrix' }, 'tv:1396': { title: 'Breaking Bad' } }),
  'ventic.progress': JSON.stringify({ 'movie:603': { position: 10, duration: 100, at: 1, watched: false } }),
  'ventic.favourites': JSON.stringify({ 'tv:1396': 5 }),
  'ventic.watchlist': JSON.stringify({ 'movie:603': 6, 'tv:1396': 7 }),
  'ventic.sources': JSON.stringify(['https://a.example']),
  'ventic.theme': '"dark"',
  // Somebody else's key in the same origin — never ours to carry or restore.
  'vuetify:dynamic-theme': 'x',
})

const backup = makeBackup(live, 42)
assert.equal(backup.at, 42)
assert.deepEqual(Object.keys(backup.keys).sort(), [
  'ventic.favourites',
  'ventic.media',
  'ventic.progress',
  'ventic.sources',
  'ventic.theme',
  'ventic.watchlist',
])

const round = readBackup(JSON.stringify(backup))
assert.deepEqual(round, backup, 'written and read back unchanged')
assert.deepEqual(backupSummary(round), { titles: 2, watched: 1, favourites: 1, watchlist: 2, sources: 1, settings: 6 })

// Restoring is assignment, not a merge — but only of what the file names, so a
// preference this build has and the backup doesn't is left where it is.
const target = fakeStore({ 'ventic.media': '{}', 'ventic.uiScale': '1.4' })
applyBackup(round, target)
assert.equal(target.data['ventic.media'], live.data['ventic.media'], 'replaced')
assert.equal(target.data['ventic.uiScale'], '1.4', 'a key the backup never mentions survives')

// A file can come from anywhere, so nothing outside our own prefix is written
// back however the file asks — this is the whole trust boundary.
const hostile = readBackup(JSON.stringify({
  app: 'ventic',
  version: 1,
  at: 1,
  keys: { 'ventic.theme': '"light"', 'token': 'nope', 'vuetify:dynamic-theme': 'nope' },
}))
assert.deepEqual(Object.keys(hostile.keys), ['ventic.theme'])

// --- Placeholder cards ---------------------------------------------------------
// A title with no snapshot is rendered rather than dropped, and the only useful
// thing about that card is that it still goes somewhere: the detail page asks
// TMDB again. If the key ever stops resolving to a route, the placeholder is a
// dead card and dropping it would have been better.

assert.equal(mediaLink(placeholder('tv:1396')), '/tv/1396')
assert.equal(mediaLink(placeholder('movie:603')), '/movie/603')
// The rows key by title, but an episode key must not produce a nonsense route.
assert.equal(mediaLink(placeholder('tv:1396:2:3')), '/tv/1396')
// remember() refuses a snapshot carrying this, so the stand-in can never be
// saved as real detail and block the fetch that would replace it.
assert.equal(placeholder('movie:603').title, UNKNOWN_TITLE)
assert.equal(placeholder('movie:603').poster, null)

for (const [text, why] of [
  ['not json at all', 'not JSON'],
  ['{}', 'no app marker'],
  ['null', 'null parses fine and is still not a backup'],
  ['{"app":"something-else","version":1,"keys":{}}', 'another app\'s file'],
  ['{"app":"ventic","version":9,"keys":{"ventic.theme":"1"}}', 'a format this build cannot read'],
  ['{"app":"ventic","version":1,"keys":{}}', 'nothing to restore'],
] as const)
  assert.throws(() => readBackup(text), Error, why)

console.log('check-library: ok')
