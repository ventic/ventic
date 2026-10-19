// The episode calendar: which shows it follows, and what of theirs is new or on
// its way. Pure functions only — `bun run check:calendar` holds them, and the
// store (stores/calendar.ts) is the fetching around them.
import type { Progress } from './library'
// Explicit, not auto-imported: the check script loads this file outside Nuxt.
import { parseKey, progressKey } from './library'

/** One episode on the calendar. */
export interface Airing {
  show: number
  showName: string
  poster: string | null
  season: number
  episode: number
  name: string
  /** `YYYY-MM-DD`, as TMDB gives it — a day with no time and no zone. */
  air: string
  still: string | null
}

/** What TMDB knows about one show's schedule: the newest episode out, and the next one due. */
export interface Schedule {
  show: number
  last: Airing | null
  next: Airing | null
}

/** An episode played longer ago than this no longer makes a show one being watched. */
const FOLLOW_DAYS = 120

/** Out this recently and unwatched, an episode is new. */
const NEW_DAYS = 7

/**
 * The shows the calendar follows: every show in Favourites or the Watchlist,
 * and every one with an episode played in the last four months. Most recently
 * touched first, and capped, because each is a request to TMDB — a library
 * with two hundred favourites should not be two hundred calls at launch.
 */
export function followedShows(
  progress: Record<string, Progress>,
  favourites: Record<string, number>,
  watchlist: Record<string, number>,
  now = Date.now(),
  cap = 60,
): number[] {
  const latest = new Map<number, number>()
  const note = (id: number, at: number) => latest.set(id, Math.max(latest.get(id) ?? 0, at))

  for (const list of [favourites, watchlist]) {
    for (const [key, at] of Object.entries(list)) {
      const { type, id } = parseKey(key)
      if (type === 'tv' && id)
        note(id, at)
    }
  }
  for (const [key, p] of Object.entries(progress)) {
    const { type, id, season } = parseKey(key)
    if (type === 'tv' && id && season && now - p.at < FOLLOW_DAYS * 864e5)
      note(id, p.at)
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([id]) => id)
}

/**
 * Today as `YYYY-MM-DD` in the reader's own zone — the same reading of a bare
 * date `dateText` makes. A UTC one would turn the calendar over at midnight in
 * London, which is seven in the evening in New York.
 */
export function localDay(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string) {
  const day = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number)
    return Date.UTC(y!, (m ?? 1) - 1, dd ?? 1)
  }
  return Math.round((day(to) - day(from)) / 864e5)
}

export interface CalendarRows {
  /** Out in the last week and not watched yet, newest first. */
  fresh: Airing[]
  today: Airing[]
  tomorrow: Airing[]
  /** Two to seven days away. */
  week: Airing[]
  later: Airing[]
}

/**
 * The calendar's rows. TMDB moves an episode from `next` to `last` on its own
 * schedule, so the date decides and not the field: anything whose day has
 * passed is out, and so is one TMDB already counts as `last` on its day — the
 * same episode still listed as `next` is due today until then.
 */
export function arrangeCalendar(
  schedules: Schedule[],
  today: string,
  watched: (show: number, season: number, episode: number) => boolean,
): CalendarRows {
  const rows: CalendarRows = { fresh: [], today: [], tomorrow: [], week: [], later: [] }
  for (const s of schedules) {
    for (const a of [s.last, s.next]) {
      if (!a?.air)
        continue
      const days = daysBetween(today, a.air)
      if (days < 0 || (days === 0 && a === s.last)) {
        if (days > -NEW_DAYS && !watched(a.show, a.season, a.episode))
          rows.fresh.push(a)
      }
      else if (days === 0) {
        rows.today.push(a)
      }
      else if (days === 1) {
        rows.tomorrow.push(a)
      }
      else {
        (days <= 7 ? rows.week : rows.later).push(a)
      }
    }
  }
  // One card per show, its newest: a daily show TMDB is a day behind on has
  // both its last and its "next" out already, and two cards for one show is a
  // row saying the same thing twice. Continue watching keeps to one per title
  // for the same reason.
  rows.fresh.sort((a, b) => b.air.localeCompare(a.air) || b.episode - a.episode || a.showName.localeCompare(b.showName))
  rows.fresh = rows.fresh.filter((a, i, list) => list.findIndex(b => b.show === a.show) === i)
  for (const list of [rows.today, rows.tomorrow, rows.week, rows.later])
    list.sort((a, b) => a.air.localeCompare(b.air) || a.showName.localeCompare(b.showName))
  return rows
}

/** What one show's TMDB detail says about its last and next episode. */
interface RawAiring {
  air_date?: string | null
  season_number?: number
  episode_number?: number
  name?: string
  still_path?: string | null
}

export interface RawSchedule {
  id: number
  name?: string
  poster_path?: string | null
  last_episode_to_air?: RawAiring | null
  next_episode_to_air?: RawAiring | null
}

export function toSchedule(raw: RawSchedule): Schedule {
  const airing = (e?: RawAiring | null): Airing | null => e?.air_date && e.season_number && e.episode_number
    ? {
        show: raw.id,
        showName: raw.name ?? '',
        poster: raw.poster_path ?? null,
        season: e.season_number,
        episode: e.episode_number,
        name: e.name ?? '',
        air: e.air_date,
        still: e.still_path ?? null,
      }
    : null
  return { show: raw.id, last: airing(raw.last_episode_to_air), next: airing(raw.next_episode_to_air) }
}

/** The key an air-day notification is remembered by, so it is said once. */
export function airingKey(a: Pick<Airing, 'show' | 'season' | 'episode'>) {
  return progressKey('tv', a.show, a.season, a.episode)
}
