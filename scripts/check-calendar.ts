// Self-check for the episode calendar: `bun scripts/check-calendar.ts`.
//
// Three things here are wrong in ways nobody sees until a show they follow is
// missing from it: which shows count as followed, which day an episode lands
// on (a bare TMDB date read as UTC is a day out for half the world), and when
// an episode stops being "next" and starts being new — TMDB moves it over on
// its own schedule, so the date has to decide, not the field.
import type { Airing, Schedule } from '../app/utils/calendar'
import assert from 'node:assert'
import { arrangeCalendar, daysBetween, followedShows, localDay, toSchedule } from '../app/utils/calendar'
import './i18n-stub'

const DAY = 864e5
const now = Date.UTC(2026, 9, 20, 12)
const p = (at: number, watched = false) => ({ position: 0, duration: 0, at, watched })

// --- What it follows ------------------------------------------------------------

const followed = followedShows(
  {
    'tv:1:1:1': p(now - 2 * DAY),
    'tv:2:3:4': p(now - 200 * DAY), // long abandoned
    'tv:3': p(now - DAY, true), // the whole show marked watched by hand: finished, not followed
    'movie:4': p(now),
  },
  { 'tv:5': now - 10 * DAY, 'movie:6': now },
  { 'tv:7': now - 5 * DAY, 'tv:1': now - 30 * DAY },
  now,
)
assert.deepEqual(followed, [1, 7, 5], 'shows only, latest first, each once, and nothing abandoned')
assert.equal(followedShows({}, Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`tv:${i + 1}`, i])), {}, now).length, 60, 'capped: each is a request')

// --- Days -----------------------------------------------------------------------

assert.equal(localDay(new Date(2026, 0, 5, 23, 30)), '2026-01-05', 'the reader\'s own day, not UTC\'s')
assert.equal(daysBetween('2026-10-20', '2026-10-21'), 1)
assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1, 'across a month')
assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2, 'across a clock change')
assert.equal(daysBetween('2026-10-20', '2026-10-13'), -7)

// --- The rows ---------------------------------------------------------------------

const today = '2026-10-20'
function ep(show: number, season: number, episode: number, air: string): Airing {
  return { show, showName: `Show ${show}`, poster: null, season, episode, name: '', air, still: null }
}
const schedules: Schedule[] = [
  { show: 1, last: ep(1, 2, 4, '2026-10-18'), next: ep(1, 2, 5, '2026-10-25') },
  { show: 2, last: ep(2, 1, 9, '2026-10-19'), next: ep(2, 1, 10, '2026-10-21') },
  { show: 3, last: ep(3, 5, 1, '2026-10-01'), next: null }, // out a while ago
  { show: 4, last: ep(4, 1, 1, '2026-10-20'), next: ep(4, 1, 2, '2026-12-01') }, // TMDB already counts today's as out
  { show: 5, last: ep(5, 3, 1, '2026-09-01'), next: ep(5, 3, 2, '2026-10-20') }, // due today, not moved over yet
  { show: 6, last: ep(6, 1, 7, '2026-10-17'), next: ep(6, 1, 8, '2026-10-19') }, // TMDB is a day behind
]
const watched = (show: number, season: number, episode: number) => show === 2 && season === 1 && episode === 9
const rows = arrangeCalendar(schedules, today, watched)
const keys = (list: Airing[]) => list.map(a => `${a.show}:${a.season}:${a.episode}`)

assert.deepEqual(keys(rows.fresh), ['4:1:1', '6:1:8', '1:2:4'], 'out this week and unwatched, newest first')
assert.ok(!keys(rows.fresh).includes('2:1:9'), 'a watched episode is not new')
assert.ok(!keys(rows.fresh).includes('3:5:1'), 'nor is one from three weeks ago')
assert.ok(!keys(rows.fresh).includes('6:1:7'), 'and only the newest episode of a show counts')
assert.deepEqual(keys(rows.today), ['5:3:2'], 'still listed as next on its day: due today')
assert.deepEqual(keys(rows.tomorrow), ['2:1:10'])
assert.deepEqual(keys(rows.week), ['1:2:5'])
assert.deepEqual(keys(rows.later), ['4:1:2'])

// --- What TMDB sends ----------------------------------------------------------------

const schedule = toSchedule({
  id: 9,
  name: 'Show',
  poster_path: '/p.jpg',
  last_episode_to_air: { air_date: '2026-10-01', season_number: 2, episode_number: 3, name: 'Pilot' },
  next_episode_to_air: { air_date: null, season_number: 2, episode_number: 4 },
})
assert.equal(schedule.last?.showName, 'Show')
assert.equal(schedule.last?.episode, 3)
assert.equal(schedule.next, null, 'an episode with no date is not on a calendar')

console.warn('calendar: ok')
