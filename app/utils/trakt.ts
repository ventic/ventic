/**
 * Trakt — the one place watch state can live that isn't this device.
 *
 * The library is otherwise localStorage and nothing else, which is fine until
 * you own two things to watch on. This syncs both ways: the player reports what
 * it is playing (Trakt calls that scrobbling), and what was watched elsewhere
 * comes back the other way, so a show picks up on the TV where the laptop left
 * it.
 *
 * Everything is keyed by **TMDB id**, which the app already has for every title
 * — no IMDb lookup on either side, and nothing to match on a name.
 *
 * No client library. Six endpoints, plain fetch, and the merge rules
 * — the only part with a real decision in it — are pure functions with
 * `bun run check:trakt` over them.
 */
import type { Progress } from './library'
import type { Media, MediaType } from './tmdb'
// Explicit, not auto-imported: the check script loads this file outside Nuxt.
import { progressKey, titleKey } from './library'

const API = 'https://api.trakt.tv'

/** trakt.tv/oauth/applications — pushed in from runtimeConfig, the way sources are. */
let app = { id: '', secret: '' }

export function setTraktApp(id: string, secret: string) {
  app = { id: id.trim(), secret: secret.trim() }
}

/** A build with no credentials can't offer this at all, and the panel says so. */
export function traktConfigured() {
  return !!app.id && !!app.secret
}

export interface TraktTokens {
  access: string
  refresh: string
  /** ms since epoch. */
  expires: number
}

/** What the user is shown while the device flow waits: a short code and where to type it. */
export interface DeviceCode {
  device_code: string
  user_code: string
  verification_url: string
  expires_in: number
  interval: number
}

function headers(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': app.id,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function call(path: string, init: RequestInit = {}, token?: string) {
  return fetch(API + path, {
    ...init,
    headers: headers(token),
    signal: AbortSignal.timeout(20_000),
  })
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await call(path, {}, token)
  if (!res.ok)
    throw new Error(`Trakt answered HTTP ${res.status} for ${path}.`)
  return res.json() as Promise<T>
}

// --- Signing in ---------------------------------------------------------------
// The device flow, not a redirect: there is no browser to come back to on a TV,
// no loopback server to run, and the same six digits work on every target this
// app ships to. The user types them on trakt.tv on whatever device they have.

export async function deviceCode(): Promise<DeviceCode> {
  const res = await call('/oauth/device/code', {
    method: 'POST',
    body: JSON.stringify({ client_id: app.id }),
  })
  if (!res.ok)
    throw new Error(`Trakt wouldn't start the sign-in (HTTP ${res.status}).`)
  return res.json() as Promise<DeviceCode>
}

interface RawTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  created_at: number
}

function toTokens(raw: RawTokens): TraktTokens {
  return {
    access: raw.access_token,
    refresh: raw.refresh_token,
    expires: (raw.created_at + raw.expires_in) * 1000,
  }
}

/**
 * One poll of the device flow. `null` means "nobody has typed it in yet" — the
 * only outcome that isn't final, which is why this returns rather than looping
 * on its own: the caller owns the interval and the cancel button.
 */
export async function deviceToken(code: string): Promise<TraktTokens | null> {
  const res = await call('/oauth/device/token', {
    method: 'POST',
    body: JSON.stringify({ code, client_id: app.id, client_secret: app.secret }),
  })

  // 400 is "still waiting", 429 is "you're asking too often" — both mean carry on.
  if (res.status === 400 || res.status === 429)
    return null
  if (res.status === 404)
    throw new Error('Trakt no longer recognises this code. Start again.')
  if (res.status === 409)
    throw new Error('That code has already been used.')
  if (res.status === 410)
    throw new Error('The code expired before it was entered.')
  if (res.status === 418)
    throw new Error('Sign-in was denied on trakt.tv.')
  if (!res.ok)
    throw new Error(`Trakt answered HTTP ${res.status}.`)

  return toTokens(await res.json() as RawTokens)
}

export async function refreshTokens(refresh: string): Promise<TraktTokens> {
  const res = await call('/oauth/token', {
    method: 'POST',
    body: JSON.stringify({
      refresh_token: refresh,
      client_id: app.id,
      client_secret: app.secret,
      // What OAuth calls "no redirect at all", which is what a device flow is.
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok)
    throw new Error(`Trakt would not renew the sign-in (HTTP ${res.status}).`)
  return toTokens(await res.json() as RawTokens)
}

export async function username(token: string): Promise<string> {
  const me = await get<{ username?: string, name?: string }>('/users/me', token)
  return me.name || me.username || 'Trakt'
}

// --- Naming a thing -----------------------------------------------------------

type Titled = Pick<Media, 'id' | 'type'>

/** `{ ids: { tmdb } }` is how Trakt is told which title, in every request below. */
function ids(m: Titled) {
  return { ids: { tmdb: Number(m.id) } }
}

/**
 * The body that names one playable thing. Null for a show with no episode: a
 * series as a whole is not something that can be played, scrobbled or added to
 * a history, and sending one would be recorded against the wrong thing.
 */
export function playedBody(m: Titled, season = 0, episode = 0) {
  if (m.type !== 'tv')
    return { movie: ids(m) }
  return season > 0 && episode > 0
    ? { show: ids(m), episode: { season, number: episode } }
    : null
}

/**
 * The two lists Trakt keeps that this app has a page for. Same request body,
 * same response shape, same endpoints under a different name — which is why
 * there is one set of functions below taking the name rather than two sets.
 *
 * Trakt's American spelling, because it is a URL, not UI copy.
 */
export type TraktList = 'watchlist' | 'favorites'

/** Both lists hold whole titles, so a show goes in as a show. */
export function listBody(m: Titled) {
  return m.type === 'tv' ? { shows: [ids(m)] } : { movies: [ids(m)] }
}

// --- Pushing ------------------------------------------------------------------

export type ScrobbleAction = 'start' | 'pause' | 'stop'

/**
 * What the player has to say, which is not the same list: a `tick` is the
 * every-two-seconds sample that keeps local progress current and maps to a
 * `start` scrobble, because Trakt's "start" means "this is playing now".
 */
export type PlayEvent = 'tick' | 'pause' | 'stop'

const SCROBBLE: Record<PlayEvent, ScrobbleAction> = { tick: 'start', pause: 'pause', stop: 'stop' }

export function scrobbleAction(event: PlayEvent): ScrobbleAction {
  return SCROBBLE[event]
}

/**
 * Tell Trakt what is playing. A `stop` past ~80% is what makes it count as
 * watched; below that Trakt files it as a resume point instead, which is what
 * comes back out of `/sync/playback`.
 *
 * 409 is Trakt saying it already has a scrobble in flight for this — two
 * devices playing the same episode, or a restart inside its window. Nothing has
 * gone wrong and there is nothing for the user to do about it.
 */
export async function scrobble(action: ScrobbleAction, body: object, progress: number, token: string) {
  const res = await call(`/scrobble/${action}`, {
    method: 'POST',
    body: JSON.stringify({ ...body, progress: Math.max(0, Math.min(100, progress)) }),
  }, token)
  if (!res.ok && res.status !== 409)
    throw new Error(`Trakt refused the scrobble (HTTP ${res.status}).`)
}

/**
 * Watched marks made by hand here, added to or taken out of Trakt's history.
 *
 * Not `history`: that is a DOM global, and an auto-imported function by the same
 * name type-checks as `window.history` at every call site — callable at runtime,
 * an error on the page.
 */
export async function historyChange(add: boolean, body: object, token: string) {
  const res = await call(`/sync/history${add ? '' : '/remove'}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
  if (!res.ok)
    throw new Error(`Trakt refused the history change (HTTP ${res.status}).`)
}

interface PlayedBody {
  movie?: { ids: { tmdb: number } }
  show?: { ids: { tmdb: number } }
  episode?: { season: number, number: number }
}

/**
 * Any number of `playedBody` results as the one nested list `/sync/history`
 * takes, episodes grouped under their show and season.
 *
 * Marking a season watched is one gesture, and this is what keeps it one
 * request: the alternative is twenty-odd POSTs into an endpoint that rate-limits
 * writes, which fails somewhere in the middle and leaves half a season marked.
 */
export function historyBody(bodies: object[]) {
  const movies = new Map<number, { ids: { tmdb: number } }>()
  const shows = new Map<number, { ids: { tmdb: number }, seasons: Map<number, Set<number>> }>()

  for (const raw of bodies as PlayedBody[]) {
    if (raw.movie) {
      movies.set(raw.movie.ids.tmdb, raw.movie)
      continue
    }
    if (!raw.show || !raw.episode)
      continue
    const show = shows.get(raw.show.ids.tmdb) ?? { ids: raw.show.ids, seasons: new Map() }
    const season = show.seasons.get(raw.episode.season) ?? new Set<number>()
    season.add(raw.episode.number)
    show.seasons.set(raw.episode.season, season)
    shows.set(raw.show.ids.tmdb, show)
  }

  return {
    movies: [...movies.values()],
    shows: [...shows.values()].map(s => ({
      ids: s.ids,
      seasons: [...s.seasons].map(([number, episodes]) => ({
        number,
        episodes: [...episodes].map(n => ({ number: n })),
      })),
    })),
  }
}

/**
 * Add to or take out of one of Trakt's lists.
 *
 * 420 is Trakt saying the account is at its cap for that list. It is the one
 * failure here the user can actually do something about, so it gets a message
 * that says what happened rather than a status code — and, like every other
 * push, it changes nothing locally: the entry is already saved on this device.
 */
export async function listChange(list: TraktList, add: boolean, body: object, token: string) {
  const res = await call(`/sync/${list}${add ? '' : '/remove'}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
  if (res.status === 420)
    throw new Error(`Your Trakt ${list} is full, so this is saved here but not there.`)
  if (!res.ok)
    throw new Error(`Trakt refused the ${list} change (HTTP ${res.status}).`)
}

// --- Pulling ------------------------------------------------------------------

interface RawIds { ids?: { tmdb?: number | null } }
interface RawWatchedMovie { last_watched_at?: string, movie?: RawIds }
interface RawWatchedShow {
  show?: RawIds
  seasons?: { number?: number, episodes?: { number?: number, last_watched_at?: string }[] }[]
}
interface RawPlayback {
  progress?: number
  paused_at?: string
  type?: string
  movie?: RawIds
  show?: RawIds
  episode?: { season?: number, number?: number }
}
interface RawListed { movie?: RawIds, show?: RawIds }

/** A title Trakt named, in the terms the rest of the app uses. */
export interface RemoteTitle {
  type: MediaType
  id: number
  season: number
  episode: number
  /** The `progress` key this maps to — `movie:603`, `tv:1396:2:3`. */
  key: string
}

function titleOf(raw: RawListed & { episode?: { season?: number, number?: number } }): RemoteTitle | null {
  const movie = raw.movie?.ids?.tmdb
  if (movie)
    return { type: 'movie', id: movie, season: 0, episode: 0, key: progressKey('movie', movie) }

  const show = raw.show?.ids?.tmdb
  const season = raw.episode?.season ?? 0
  const episode = raw.episode?.number ?? 0
  // Season 0 is specials, which the app has no route to and cannot resume.
  if (!show || season <= 0 || episode <= 0)
    return null
  return { type: 'tv', id: show, season, episode, key: progressKey('tv', show, season, episode) }
}

/** Everything Trakt has as watched, flattened to one entry per playable thing. */
export function watchedTitles(movies: RawWatchedMovie[], shows: RawWatchedShow[]) {
  const out: (RemoteTitle & { at: number })[] = []

  for (const m of movies) {
    const title = titleOf(m)
    if (title)
      out.push({ ...title, at: Date.parse(m.last_watched_at ?? '') || 0 })
  }

  for (const s of shows) {
    for (const season of s.seasons ?? []) {
      for (const ep of season.episodes ?? []) {
        const title = titleOf({ show: s.show, episode: { season: season.number, number: ep.number } })
        if (title)
          out.push({ ...title, at: Date.parse(ep.last_watched_at ?? '') || 0 })
      }
    }
  }

  return out
}

/** What Trakt has part-watched, as a percentage — it stores no seconds. */
export function playbackTitles(raw: RawPlayback[]) {
  return raw.flatMap(p => {
    const title = titleOf(p)
    const percent = Number(p.progress) || 0
    return title && percent > 0 ? [{ ...title, percent, at: Date.parse(p.paused_at ?? '') || 0 }] : []
  })
}

/**
 * The annotation is load-bearing: without it the two returns infer as two
 * different array types, `flatMap` picks its readonly overload, and every caller
 * downstream ends up holding `unknown[]`.
 */
export function listedTitles(movies: RawListed[], shows: RawListed[]) {
  return [...movies, ...shows].flatMap((raw): { type: MediaType, id: number, key: string }[] => {
    const movie = raw.movie?.ids?.tmdb
    const show = raw.show?.ids?.tmdb
    if (movie)
      return [{ type: 'movie' as const, id: movie, key: titleKey('movie', movie) }]
    return show ? [{ type: 'tv' as const, id: show, key: titleKey('tv', show) }] : []
  })
}

export function fetchWatched(token: string) {
  return Promise.all([
    get<RawWatchedMovie[]>('/sync/watched/movies', token),
    // Without the seasons this is a list of shows, and the app needs the
    // episodes — that is what "carry on from where you were" is made of.
    get<RawWatchedShow[]>('/sync/watched/shows', token),
  ])
}

export function fetchPlayback(token: string) {
  return get<RawPlayback[]>('/sync/playback?limit=100', token)
}

export function fetchList(list: TraktList, token: string) {
  return Promise.all([
    get<RawListed[]>(`/sync/${list}/movies`, token),
    get<RawListed[]>(`/sync/${list}/shows`, token),
  ])
}

/** How many items this account may hold in each list. 0 means Trakt didn't say. */
export type TraktLimits = Record<TraktList, number>

/**
 * The caps on this account. Asked for rather than hard-coded: they are a
 * free-versus-VIP thing that Trakt has already moved once, and a number written
 * into the app is one that warns the wrong people the day it changes.
 *
 * Nothing is blocked by these — a list here is allowed past its cap and keeps
 * working. They exist only to say why Trakt has stopped keeping up.
 */
/**
 * How many entries a local list holds that Trakt won't. A cap of 0 is "Trakt
 * hasn't said" and warns nobody; the count is compared as it is, so the first
 * entry past the cap is the first one over.
 */
export function overLimit(cap: number, count: number) {
  return cap > 0 && count > cap ? count - cap : 0
}

export async function fetchLimits(token: string): Promise<TraktLimits> {
  const raw = await get<{ limits?: Record<string, { item_count?: number }> }>('/users/settings', token)
  return {
    watchlist: Number(raw.limits?.watchlist?.item_count) || 0,
    favorites: Number(raw.limits?.favorites?.item_count) || 0,
  }
}

// --- Merging ------------------------------------------------------------------
// The only part with a decision in it, so the only part with a check over it.
// Two devices disagreeing about an episode is the normal case, not the edge one.

/**
 * Watched marks from Trakt folded into what this device knows.
 *
 * Watched wins over not-watched in both directions — the point of the sync is
 * that an episode seen on the laptop stops coming up on the TV — but a local
 * entry that is already watched is left exactly as it is, because it carries a
 * duration and a position Trakt has never heard of.
 */
export function mergeWatched(local: Record<string, Progress>, remote: { key: string, at: number }[]) {
  const merged = { ...local }
  let added = 0

  for (const { key, at } of remote) {
    const own = merged[key]
    if (own?.watched)
      continue
    merged[key] = {
      // What `setWatched(true)` stores: a full bar, and no resume point left.
      position: own?.duration ?? 0,
      duration: own?.duration ?? 0,
      at: at || own?.at || Date.now(),
      watched: true,
    }
    added++
  }

  return { merged, added }
}

/**
 * Resume points from Trakt. It stores a percentage and this app stores seconds,
 * so the caller resolves a duration first — from a previous play here, or from
 * TMDB's runtime for the title.
 *
 * A local record wins whenever it is newer, and anything already finished here
 * is never walked back: being 40% through on another device is not a reason to
 * un-watch something.
 */
export function mergeProgress(
  local: Record<string, Progress>,
  remote: { key: string, position: number, duration: number, at: number }[],
) {
  const merged = { ...local }
  let added = 0

  for (const r of remote) {
    const own = merged[r.key]
    if (own?.watched || (own && own.at >= r.at) || !r.duration || r.position <= 0)
      continue
    merged[r.key] = { position: r.position, duration: r.duration, at: r.at, watched: false }
    added++
  }

  return { merged, added }
}
