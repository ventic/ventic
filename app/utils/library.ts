// Watch state: what has been played, how far, and what to play next.
// Pure functions only — `bun run check:library` exercises them, and the store
// (stores/library.ts) is the reactive localStorage wrapper around them.
import type { Media, MediaType } from './tmdb'
// Explicit, not auto-imported: the check script loads this file outside Nuxt.
import { ANIMATION, runtimeText } from './tmdb'

/**
 * Seconds of a file that count as "seen it". Plex's number, and it holds up:
 *  nobody sits through the credits, and everybody closes the window in them.
 */
const WATCHED_AT = 0.9

/** Below this, you were still deciding whether to watch it. */
const RESUME_AFTER = 60

export interface Progress {
  /** Seconds into the file when it was last left. */
  position: number
  /** 0 until mpv reports one. */
  duration: number
  /** Last played, ms since epoch. */
  at: number
  watched: boolean
}

/** `movie:603`, or `tv:1396` for a show as a whole. What both lists key off. */
export function titleKey(type: MediaType, id: number | string) {
  return `${type}:${id}`
}

/** `movie:603` / `tv:1396:2:3` — the identity of one playable thing. */
export function progressKey(type: MediaType, id: number | string, season = 0, episode = 0) {
  return season && episode ? `tv:${id}:${season}:${episode}` : titleKey(type, id)
}

export function parseKey(key: string) {
  const [type, id, season, episode] = key.split(':')
  return {
    type: type as MediaType,
    id: Number(id),
    season: Number(season) || 0,
    episode: Number(episode) || 0,
    /** The title this belongs to: `tv:1396:2:3` -> `tv:1396`. */
    title: `${type}:${id}`,
  }
}

/**
 * Past the 90% mark. This is the whole "they closed the credits" allowance:
 * anything after it is treated as the end of the file, watched, and not worth
 * resuming.
 */
export function finished(position: number, duration: number) {
  return duration > 0 && position >= duration * WATCHED_AT
}

/** Worth offering to pick up again — barely started and nearly done both aren't. */
export function resumable(position: number, duration: number) {
  return position > RESUME_AFTER && !finished(position, duration)
}

/** 0–1, for the sliver of bar across the bottom of a card. */
export function fraction(p?: Progress | null) {
  if (!p)
    return 0
  if (p.watched)
    return 1
  return p.duration ? Math.min(1, p.position / p.duration) : 0
}

export interface EpisodeRef {
  season: number
  episode: number
}

/**
 * Where a show picks up. The last episode played, if it was left part-way
 * through; otherwise the one after it, rolling over into the next season.
 * Null once the finale has been watched — callers decide whether that means
 * "start over" or "offer nothing".
 */
export function nextEpisode(
  seasons: { number: number, episodes: number }[],
  last?: (EpisodeRef & { watched: boolean }) | null,
): EpisodeRef | null {
  if (!last)
    return seasons[0] ? { season: seasons[0].number, episode: 1 } : null

  if (!last.watched)
    return { season: last.season, episode: last.episode }

  // A season TMDB no longer lists (a re-cut show, or a stale entry) has no
  // "next" that can be worked out. Returning the first episode here would
  // silently restart the whole show, so say nothing instead.
  const index = seasons.findIndex(s => s.number === last.season)
  if (index < 0)
    return null

  const season = seasons[index]!
  if (last.episode < season.episodes)
    return { season: last.season, episode: last.episode + 1 }

  const after = seasons[index + 1]
  return after ? { season: after.number, episode: 1 } : null
}

/**
 * Every episode of one show, most recently played first. The store keeps one
 * flat map, so a show's episodes are found by prefix rather than by nesting.
 */
export function showEntries(progress: Record<string, Progress>, showId: number | string) {
  const prefix = `tv:${showId}:`
  return Object.entries(progress)
    .filter(([key]) => key.startsWith(prefix))
    // Marking a run of episodes at once stamps every one of them in the same
    // millisecond, so the latest episode has to win that tie: otherwise
    // "watched up to E5" would have the show resuming at E1.
    .sort(([aKey, a], [bKey, b]) => {
      if (a.at !== b.at)
        return b.at - a.at
      const x = parseKey(aKey)
      const y = parseKey(bKey)
      return y.season - x.season || y.episode - x.episode
    })
}

/**
 * How many episodes of one season are marked watched — what a season card's bar
 * measures. Counted off the keys because the store keeps one flat map; the
 * trailing colon is what keeps season 1 out of season 10.
 */
export function watchedInSeason(progress: Record<string, Progress>, showId: number | string, season: number) {
  const prefix = `tv:${showId}:${season}:`
  return Object.entries(progress).filter(([key, p]) => key.startsWith(prefix) && p.watched).length
}

/**
 * What "Continue watching" lists: everything part-way through, newest first,
 * and only one card per title — being six episodes into a show is one thing to
 * carry on with, not six.
 */
export function continuing(progress: Record<string, Progress>, media: Record<string, Media> = {}) {
  const seen = new Set<string>()
  return Object.entries(progress)
    .sort((a, b) => b[1].at - a[1].at)
    .flatMap(([key, p]) => {
      const { title, type, id, season, episode } = parseKey(key)
      if (seen.has(title))
        return []

      if (resumable(p.position, p.duration)) {
        seen.add(title)
        return [{ key, title, season, episode, progress: p as Progress | null }]
      }

      // Finishing an episode is not finishing the show: what you carry on with
      // is the next one, and across a season boundary that is the next season's
      // first — which is the whole reason a show's snapshot keeps its episode
      // counts. Without them (a library that predates the field, or a show only
      // ever played from a magnet) there is nothing to roll over to, so the
      // title falls through to whatever else it has, exactly as it used to.
      if (type !== 'tv' || !p.watched)
        return []

      const up = nextEpisode(media[title]?.seasons ?? [], { season, episode, watched: true })
      // Already seen the one that comes next — this is a rewatch working
      // backwards, not a show waiting to be carried on with.
      if (!up || progress[progressKey('tv', id, up.season, up.episode)]?.watched)
        return []

      seen.add(title)
      return [{
        key: progressKey('tv', id, up.season, up.episode),
        title,
        season: up.season,
        episode: up.episode,
        // Nothing played yet, so there is no bar to draw.
        progress: null as Progress | null,
      }]
    })
}

export interface WatchBar {
  /** 0–1, how far across to paint it. */
  fraction: number
  /** What it is measuring, or '' when the bar speaks for itself. */
  label: string
}

/**
 * The strip across the bottom of a card: how far through, and what that is
 * measuring.
 *
 * A film's bar is its position in the file. A show's is its position in the
 * show* — episodes watched out of the episodes there are, plus the fraction of
 * the one in hand — because once you have finished an episode the file position
 * is 100% of something already seen, and says nothing about the forty that are
 * left. That is also the moment the card has the most to say, so the label
 * names the episode you would carry on with rather than the one just watched.
 *
 * `m` should be the *stored* snapshot: a card off a browse page carries no
 * season list, and with no counts this falls back to the position in the last
 * episode played, which is what it always did.
 *
 * Null when there is nothing to draw — never played, or played right out.
 */
export function watchBar(progress: Record<string, Progress>, m: Media): WatchBar | null {
  if (m.type !== 'tv') {
    const p = progress[titleKey('movie', m.id)]
    return p && !p.watched && fraction(p) > 0 ? { fraction: fraction(p), label: '' } : null
  }

  const entries = showEntries(progress, m.id)
  // A show marked watched by hand has no episode entry to measure against.
  const [key, latest] = entries[0] ?? []
  const at = latest ?? progress[titleKey('tv', m.id)]
  // Only an unfinished episode is a part: a watched one is already in the count.
  const part = at && !at.watched ? fraction(at) : 0

  const up = key && latest ? nextEpisode(m.seasons ?? [], { ...parseKey(key), watched: latest.watched }) : null
  const label = up ? `S${up.season} E${up.episode}` : ''

  const total = (m.seasons ?? []).reduce((n, s) => n + s.episodes, 0)
  if (!total)
    return part > 0 ? { fraction: part, label } : null

  const seen = entries.filter(([, p]) => p.watched).length
  if (seen >= total)
    return null // every episode there is — the tick says that, not a full bar
  const done = Math.min(seen + part, total)
  return done > 0
    ? { fraction: done / total, label: label && `${label} · ${seen}/${total}` }
    : null
}

/** Title keys of everything ever played, most recent first. */
export function playedTitles(progress: Record<string, Progress>) {
  const latest = new Map<string, number>()
  for (const [key, p] of Object.entries(progress)) {
    const { title } = parseKey(key)
    latest.set(title, Math.max(latest.get(title) ?? 0, p.at))
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([title]) => title)
}

/** What a card stands in with when this device knows nothing but the id. */
/**
 * Deliberately NOT translated. This is a sentinel as much as a label: it is
 * written into the stored card (`slim`) and read back by the library store to
 * tell a placeholder from a title the app actually learned. Translating it
 * would make that test depend on which language the placeholder was saved in.
 */
export const UNKNOWN_TITLE = 'Unknown title'

/**
 * A card for a title with no snapshot on this device: an episode marked by hand
 * from a row that knew the show's id and nothing else, or a restored backup
 * whose TMDB detail never landed. Shown rather than dropped — the entry is real
 * and so is the watch state behind it, and a row that silently isn't there
 * reads as the app having lost it.
 *
 * No UI of its own: a null poster is already a case MediaPoster draws, because
 * plenty of real titles have no artwork. The card still links to the detail page,
 * which asks TMDB again and may well get an answer.
 */
export function placeholder(key: string): Media {
  const { type, id } = parseKey(key)
  return {
    id,
    type,
    title: UNKNOWN_TITLE,
    year: '',
    poster: null,
    backdrop: null,
    overview: '',
    rating: 0,
    genreIds: [],
    lang: '',
  }
}

/** "1h 12m left" for the resume button; '' when there's nothing to say. */
export function remainingText(p?: Progress | null) {
  if (!p || p.watched || !p.duration)
    return ''
  const minutes = Math.round((p.duration - p.position) / 60)
  return minutes > 0 ? `${runtimeText(minutes)} left` : ''
}

/**
 * Only the fields a card needs. Detail responses carry cast, crew and images,
 * and every one of them would be copied into localStorage forever.
 */
export function slim(m: Media): Media {
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    year: m.year,
    poster: m.poster,
    backdrop: m.backdrop,
    overview: m.overview,
    rating: m.rating,
    genreIds: m.genreIds,
    lang: m.lang,
    // Number and count only — a Season also carries a name, a poster and an
    // overview, and none of that is ever read back off a stored snapshot.
    ...(m.seasons?.length
      ? { seasons: m.seasons.map(s => ({ number: s.number, episodes: s.episodes })) }
      : {}),
  }
}

// --- Narrowing a library page ------------------------------------------------

/** The buckets the app's own navigation already splits titles into. */
export type LibraryKind = 'all' | 'movie' | 'tv' | 'anime'
export type LibrarySort = 'recent' | 'title' | 'year' | 'rating'

export interface LibraryView {
  query: string
  kind: LibraryKind
  sort: LibrarySort
  /** Flips whatever order `sort` picked; each one already leads with its useful end. */
  reverse: boolean
}

/**
 * Which of the three nav pages a title belongs on. Animation + Japanese is the
 * pair the Anime page asks TMDB for, and it is exclusive here for the same
 * reason it is there: an anime film is on the Anime page, not the Movies one.
 *
 * ponytail: a snapshot saved before `lang` was kept has none, so the genre
 * alone stands in and over-counts western animation until `remember` backfills
 * it. Drop the fallback once no library predates the field.
 */
export function kindOf(m: Media): Exclude<LibraryKind, 'all'> {
  return m.genreIds.includes(ANIMATION) && (m.lang ?? 'ja') === 'ja' ? 'anime' : m.type
}

function rank(m: Media, sort: LibrarySort) {
  return sort === 'year' ? Number(m.year) || 0 : m.rating
}

/**
 * What Favourites, the Watchlist and History actually render: the list the store
 * hands over, narrowed and reordered. Pure, so `check:library` holds the rules.
 */
export function arrange(items: Media[], view: LibraryView) {
  const q = view.query.trim().toLowerCase()
  // filter() already copies, so the sort below is not the caller's array.
  const shown = items.filter(m =>
    (view.kind === 'all' || kindOf(m) === view.kind)
    && (!q || m.title.toLowerCase().includes(q)))

  // 'recent' is the order the store keeps them in — newest first, either by
  // when it was added or by when it was last played.
  if (view.sort === 'title')
    shown.sort((a, b) => a.title.localeCompare(b.title))
  else if (view.sort !== 'recent')
    shown.sort((a, b) => rank(b, view.sort) - rank(a, view.sort))

  return view.reverse ? shown.reverse() : shown
}
