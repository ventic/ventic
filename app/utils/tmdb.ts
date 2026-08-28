// TMDB v3 — https://developer.themoviedb.org/reference/intro/getting-started
// The token in TMDB_API is the v4 "API Read Access Token" (sent as a Bearer).

export type MediaType = 'movie' | 'tv'

export interface TmdbItem {
  id: number
  media_type?: MediaType | 'person'
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
  backdrop_path?: string | null
  overview?: string
  vote_average?: number
  vote_count?: number
  genre_ids?: number[]
  original_language?: string
}

export interface TmdbPage<T = TmdbItem> {
  page: number
  results: T[]
  total_pages: number
  total_results: number
}

export interface Genre {
  id: number
  name: string
}

/** TMDB's Animation genre, in both the movie and tv lists. */
export const ANIMATION = 16

/** Everything the UI renders, with movie/tv field differences already flattened. */
export interface Media {
  id: number
  type: MediaType
  title: string
  year: string
  /** Raw TMDB paths — size is picked at render time by posterUrl/backdropUrl. */
  poster: string | null
  backdrop: string | null
  overview: string
  rating: number
  genreIds: number[]
  /**
   * ISO 639-1 original language. Optional because a card snapshot stored before
   * it was kept has none — see `kindOf` for what stands in there.
   */
  lang?: string
  /**
   * Episode counts per season, and only on a *show's* snapshot. A list response
   * carries none — only a detail one fills this in — but once it has, the
   * library can work out which episode comes next without asking TMDB again,
   * which is what keeps a show in "Continue watching" across a season boundary
   * (see `continuing`).
   */
  seasons?: { number: number, episodes: number }[]
}

export function tmdb<T>(path: string, params?: Record<string, unknown>) {
  // The user's own token wins when they have set one — see `tmdbKey` in the
  // settings store for why that escape hatch exists.
  const key = useSettingsStore().tmdbKey || useRuntimeConfig().public.TMDB_API

  return $fetch<T>(path, {
    baseURL: 'https://api.themoviedb.org/3',
    // Titles and overviews come back in whatever the app is set to, as the
    // regional tag TMDB wants (`pt-BR` for the `pt` the URL carries) — see
    // `tmdbLanguage`. TMDB falls back to English per field, so a language it
    // has nothing in still returns a usable record.
    params: { language: tmdbLanguage(), ...params },
    headers: { Authorization: `Bearer ${key}` },
  })
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p'

const POSTER_SIZES = [92, 154, 185, 342, 500, 780] as const

export type PosterSize = `w${typeof POSTER_SIZES[number]}`

export function posterUrl(path?: string | null, size: PosterSize = 'w342') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

/** Smallest bucket that still covers `width` device pixels — callers pass CSS px * dpr. */
export function posterFor(width: number): PosterSize {
  return `w${POSTER_SIZES.find(size => size >= width) ?? 780}`
}

export function backdropUrl(path?: string | null, size: 'w780' | 'w1280' | 'original' = 'w780') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

/**
 * Which picture sits behind the app — and so, with "take the colour from what's
 * on screen", which one the palette is generated from. A picture of the user's
 * own is the background the app rests on: artwork covers it only while they are
 * on a title (`artWins`), never because a browse page opened on some row.
 */
export function backdropFor(mode: 'art' | 'custom' | 'off', artPath: string | null | undefined, image: string, artWins: boolean) {
  if (mode === 'off')
    return undefined
  const url = backdropUrl(artPath, 'w1280')
  if (mode === 'art')
    return url ?? undefined
  return (artWins && url) || image || undefined
}

export function profileUrl(path?: string | null, size: 'w45' | 'w185' | 'h632' = 'w185') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

/** Episode thumbnails. */
export function stillUrl(path?: string | null, size: 'w300' | 'w780' = 'w300') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

/** Title treatments (transparent PNG) — used instead of text in the hero. */
export function logoUrl(path?: string | null, size: 'w300' | 'w500' = 'w500') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

/**
 * Route to a media detail page. Also the shape `[type]/[id].vue` validates.
 *
 * Every link helper here runs its path through `localePath`, which is the
 * identity under the app's `no_prefix` strategy — it is the one place that
 * would have to change if the language ever went back into the URL, instead of
 * the ~40 call sites.
 */
export function mediaLink(media: Pick<Media, 'id' | 'type'>) {
  return localePath(`/${media.type}/${media.id}`)
}

export function personLink(id: string | number) {
  return localePath(`/person/${id}`)
}

export function seasonLink(showId: string | number, season: number) {
  return localePath(`/tv/${showId}/season/${season}`)
}

export function episodeLink(showId: string | number, season: number, episode: number) {
  return `${seasonLink(showId, season)}/episode/${episode}`
}

/**
 * Route to the player. It takes the TMDB id rather than a magnet: the source
 * lookup (utils/torrents.ts) happens there, so every Play button in the app
 * only needs what it already has on screen.
 */
export function watchLink(type: MediaType, id: string | number, season?: number, episode?: number) {
  const query = new URLSearchParams({ type, id: String(id) })
  if (season && episode) {
    query.set('s', String(season))
    query.set('e', String(episode))
  }
  return `${localePath('/watch')}?${query}`
}

/** 148 -> "2h 28m". */
export function runtimeText(minutes?: number) {
  if (!minutes)
    return ''
  const h = Math.floor(minutes / 60)
  return h ? $t('{hours}h {minutes}m', { hours: h, minutes: minutes % 60 }) : $t('{minutes}m', { minutes })
}

export function moneyText(amount?: number) {
  if (!amount)
    return ''
  // Currency stays USD — it is TMDB's figure, not a converted one — but the
  // grouping and the compact suffix follow the reader's language.
  return amount.toLocaleString(uiLocale(), { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
}

/**
 * A TMDB date as the reader's locale writes it.
 *
 * The `T00:00` is the whole of it. TMDB gives a bare `YYYY-MM-DD`, which
 * `new Date` reads as midnight *UTC* and `toLocaleDateString` then renders in
 * the reader's own zone — so every air date and every birthday came out a day
 * early for everyone west of Greenwich. Adding the time with no zone on it
 * makes it midnight *here*, which is what a date carrying no time ever meant.
 */
export function dateText(date?: string) {
  if (!date)
    return ''
  const local = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00` : date
  return new Date(local).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Whole years since a date — someone's age today, or 0 if there is no date.
 *
 * Split rather than parsed. TMDB gives a bare `YYYY-MM-DD`, which `new Date`
 * reads as midnight *UTC* — so everywhere west of Greenwich the birthday landed
 * a day early and everyone was a year older for a day. There is no time in the
 * string and no timezone for it to be moved between; the three numbers are the
 * whole of it.
 */
export function yearsSince(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day)
    return 0
  const now = new Date()
  // A birthday still to come this year hasn't been had yet.
  const early = now.getMonth() + 1 < month
    || (now.getMonth() + 1 === month && now.getDate() < day)
  return Math.max(0, now.getFullYear() - year - (early ? 1 : 0))
}

/**
 * `type` is the fallback for endpoints that don't return media_type
 * (everything except /search/multi and /trending/all). Returns null for
 * people, which /search/multi mixes into results.
 */
export function toMedia(item: TmdbItem, type?: MediaType): Media | null {
  const mediaType = item.media_type ?? type
  if (mediaType !== 'movie' && mediaType !== 'tv')
    return null

  return {
    id: item.id,
    type: mediaType,
    title: item.title ?? item.name ?? $t('Untitled'),
    year: (item.release_date ?? item.first_air_date ?? '').slice(0, 4),
    poster: item.poster_path ?? null,
    backdrop: item.backdrop_path ?? null,
    overview: item.overview ?? '',
    rating: item.vote_average ?? 0,
    genreIds: item.genre_ids ?? [],
    lang: item.original_language ?? '',
  }
}

export function useGenres(type: MediaType) {
  return useAsyncData(
    `genres-${type}`,
    () => tmdb<{ genres: Genre[] }>(`/genre/${type}/list`),
    { lazy: true, default: (): Genre[] => [], transform: data => data.genres },
  )
}

/**
 * Title -> IMDb id, for the two cases a library page can't cover: TMDB has no
 * IMDb id on the summary the page was built from, or there is no TMDB entry at
 * all because the user pasted a magnet and its filename is the only clue.
 *
 * Two requests, because /search hands back TMDB ids and only the detail side
 * carries external ones. It runs at most once per playback, on a path that
 * would otherwise have nothing to search a source or subtitles with.
 */
export async function imdbIdByTitle(title: string, series = false, year = ''): Promise<string> {
  if (!title.trim())
    return ''

  const type: MediaType = series ? 'tv' : 'movie'
  try {
    const { results } = await tmdb<TmdbPage>(`/search/${type}`, { query: title })
    // Year is a preference, not a filter: passing it to TMDB turns a wrong
    // guess into no results at all, and "Dune" only needs it to break a tie.
    const hit = (year && results.find(m => (m.release_date ?? m.first_air_date ?? '').startsWith(year)))
      || results[0]
    if (!hit)
      return ''

    const { imdb_id } = await tmdb<{ imdb_id?: string | null }>(`/${type}/${hit.id}/external_ids`)
    return imdb_id ?? ''
  }
  catch {
    return '' // offline, or TMDB has never heard of it
  }
}

// --- Detail ------------------------------------------------------------------

export interface Person {
  id: number
  name: string
  role: string
  profile: string | null
}

export interface Season {
  number: number
  name: string
  episodes: number
  year: string
  poster: string | null
  overview: string
}

export interface Episode {
  number: number
  name: string
  overview: string
  air: string
  runtime: number
  still: string | null
  rating: number
}

/** A season fetched on its own — the show's season list carries no episodes. */
export interface SeasonDetail {
  number: number
  name: string
  overview: string
  air: string
  poster: string | null
  episodes: Episode[]
}

export interface EpisodeDetail extends Episode {
  season: number
  votes: number
  /** Cast credited for this episode only — the regulars are on the show. */
  guests: Person[]
  directors: string[]
  writers: string[]
}

export interface MediaDetail extends Media {
  tagline: string
  status: string
  /** Movie length, or the average episode length for a show. */
  runtime: number
  genres: Genre[]
  homepage: string
  imdbId: string | null
  /** US age rating, when TMDB has one. */
  certification: string
  votes: number
  released: string
  /** Transparent title treatment, when TMDB has an English one. */
  logo: string | null
  /** YouTube key for the best available trailer. */
  trailer: string | null
  cast: Person[]
  directors: string[]
  writers: string[]
  companies: string[]
  seasons: Season[]
  episodeCount: number
  budget: number
  revenue: number
}

// TMDB drops appends the endpoint doesn't know (content_ratings on a movie,
// release_dates on a show), so one string covers both types in one request.
// external_ids is how a show gets its IMDb id — only movies carry imdb_id
// inline, and the source protocol is keyed by that id.
const DETAIL_APPEND = 'credits,videos,images,release_dates,content_ratings,external_ids'

interface RawCredit { id: number, name: string, character?: string, job?: string, profile_path?: string | null }
interface RawImage { file_path: string, iso_639_1: string | null }
interface RawVideo { key: string, site: string, type: string, official: boolean }
interface RawSeason { season_number: number, name: string, episode_count: number, air_date?: string | null, poster_path?: string | null, overview?: string }

interface RawDetail extends TmdbItem {
  tagline?: string
  status?: string
  runtime?: number
  episode_run_time?: number[]
  number_of_episodes?: number
  genres?: Genre[]
  homepage?: string
  imdb_id?: string | null
  budget?: number
  revenue?: number
  seasons?: RawSeason[]
  production_companies?: { name: string }[]
  networks?: { name: string }[]
  last_episode_to_air?: { runtime?: number } | null
  credits?: { cast: RawCredit[], crew: RawCredit[] }
  videos?: { results: RawVideo[] }
  images?: { logos: RawImage[] }
  release_dates?: { results: { iso_3166_1: string, release_dates: { certification: string }[] }[] }
  content_ratings?: { results: { iso_3166_1: string, rating: string }[] }
  external_ids?: { imdb_id?: string | null }
}

function certificationOf(raw: RawDetail) {
  const dates = raw.release_dates?.results.find(r => r.iso_3166_1 === 'US')
  if (dates)
    return dates.release_dates.find(d => d.certification)?.certification ?? ''
  return raw.content_ratings?.results.find(r => r.iso_3166_1 === 'US')?.rating ?? ''
}

function trailerOf(raw: RawDetail) {
  const videos = (raw.videos?.results ?? []).filter(v => v.site === 'YouTube')
  const pick = videos.find(v => v.type === 'Trailer' && v.official)
    ?? videos.find(v => v.type === 'Trailer')
    ?? videos.find(v => v.type === 'Teaser')
  return pick?.key ?? null
}

function toPerson(c: RawCredit): Person {
  return { id: c.id, name: c.name, role: c.character ?? c.job ?? '', profile: c.profile_path ?? null }
}

function jobs(crew: RawCredit[], names: string[]) {
  // Same person can hold the job twice (writer + screenplay); de-dupe by name.
  return [...new Set(crew.filter(c => names.includes(c.job ?? '')).map(c => c.name))]
}

function toDetail(raw: RawDetail, type: MediaType): MediaDetail {
  const base = toMedia(raw, type)!
  const crew = raw.credits?.crew ?? []

  return {
    ...base,
    tagline: raw.tagline ?? '',
    status: raw.status ?? '',
    runtime: raw.runtime ?? raw.episode_run_time?.[0] ?? raw.last_episode_to_air?.runtime ?? 0,
    genres: raw.genres ?? [],
    homepage: raw.homepage ?? '',
    imdbId: raw.imdb_id ?? raw.external_ids?.imdb_id ?? null,
    certification: certificationOf(raw),
    votes: raw.vote_count ?? 0,
    released: raw.release_date ?? raw.first_air_date ?? '',
    logo: raw.images?.logos.find(l => l.iso_639_1 === 'en')?.file_path ?? null,
    trailer: trailerOf(raw),
    cast: (raw.credits?.cast ?? []).slice(0, 20).map(toPerson),
    directors: jobs(crew, ['Director']),
    writers: jobs(crew, ['Writer', 'Screenplay', 'Story']),
    // A show's network is the more useful credit than its production companies.
    companies: (raw.networks ?? raw.production_companies ?? []).map(c => c.name).slice(0, 3),
    // Season 0 is specials/extras — real seasons only.
    seasons: (raw.seasons ?? [])
      .filter(s => s.season_number > 0 && s.episode_count > 0)
      .map(s => ({
        number: s.season_number,
        name: s.name,
        episodes: s.episode_count,
        year: (s.air_date ?? '').slice(0, 4),
        poster: s.poster_path ?? null,
        overview: s.overview ?? '',
      })),
    episodeCount: raw.number_of_episodes ?? 0,
    budget: raw.budget ?? 0,
    revenue: raw.revenue ?? 0,
  }
}

/** Never blocks navigation — the page renders its skeleton while this resolves. */
export function useMediaDetail(type: MaybeRefOrGetter<MediaType>, id: MaybeRefOrGetter<string | number>) {
  return useAsyncData(
    () => `detail-${toValue(type)}-${toValue(id)}`,
    // No id is not a lookup that fails, it is a lookup there is nothing to make:
    // a live channel and a bare magnet both reach the player with no TMDB
    // identity at all, and `/movie/` is a 404 on the way to the same nothing.
    async () => toValue(id)
      ? await tmdb<RawDetail>(`/${toValue(type)}/${toValue(id)}`, { append_to_response: DETAIL_APPEND, include_image_language: 'en,null' })
      : null,
    {
      lazy: true,
      watch: [() => toValue(type), () => toValue(id)],
      transform: raw => raw ? toDetail(raw, toValue(type)) : null,
    },
  )
}

interface RawEpisode {
  episode_number: number
  season_number?: number
  name?: string
  overview?: string
  air_date?: string | null
  runtime?: number | null
  still_path?: string | null
  vote_average?: number
  vote_count?: number
  guest_stars?: RawCredit[]
  crew?: RawCredit[]
}

function toEpisode(e: RawEpisode): Episode {
  return {
    number: e.episode_number,
    name: e.name ?? '',
    overview: e.overview ?? '',
    air: e.air_date ?? '',
    runtime: e.runtime ?? 0,
    still: e.still_path ?? null,
    rating: e.vote_average ?? 0,
  }
}

// The season endpoint returns the episodes themselves instead of a count.
interface RawSeasonDetail extends Omit<RawSeason, 'episode_count'> {
  episodes?: RawEpisode[]
}

export function useSeason(id: MaybeRefOrGetter<string | number>, season: MaybeRefOrGetter<number>) {
  return useAsyncData(
    () => `season-${toValue(id)}-${toValue(season)}`,
    () => tmdb<RawSeasonDetail>(`/tv/${toValue(id)}/season/${toValue(season)}`),
    {
      lazy: true,
      watch: [() => toValue(id), () => toValue(season)],
      transform: (raw): SeasonDetail => ({
        number: raw.season_number,
        name: raw.name,
        overview: raw.overview ?? '',
        air: raw.air_date ?? '',
        poster: raw.poster_path ?? null,
        episodes: (raw.episodes ?? []).map(toEpisode),
      }),
    },
  )
}

export function useEpisode(
  id: MaybeRefOrGetter<string | number>,
  season: MaybeRefOrGetter<string | number>,
  episode: MaybeRefOrGetter<string | number>,
) {
  return useAsyncData(
    () => `episode-${toValue(id)}-${toValue(season)}-${toValue(episode)}`,
    // guest_stars and crew come back on this endpoint without an append.
    () => tmdb<RawEpisode>(`/tv/${toValue(id)}/season/${toValue(season)}/episode/${toValue(episode)}`),
    {
      lazy: true,
      watch: [() => toValue(id), () => toValue(season), () => toValue(episode)],
      transform: (raw): EpisodeDetail => ({
        ...toEpisode(raw),
        season: raw.season_number ?? Number(toValue(season)),
        votes: raw.vote_count ?? 0,
        guests: (raw.guest_stars ?? []).slice(0, 20).map(toPerson),
        directors: jobs(raw.crew ?? [], ['Director']),
        writers: jobs(raw.crew ?? [], ['Writer', 'Teleplay', 'Screenplay', 'Story']),
      }),
    },
  )
}

// --- People ------------------------------------------------------------------

export interface PersonDetail {
  id: number
  name: string
  biography: string
  birthday: string
  deathday: string
  birthplace: string
  profile: string | null
  /** Every title they are credited on, cast and crew alike, best known first. */
  credits: Media[]
}

interface RawPerson {
  id: number
  name?: string
  biography?: string
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
  profile_path?: string | null
  combined_credits?: { cast?: TmdbItem[], crew?: TmdbItem[] }
  translations?: { translations: { iso_639_1: string, data?: { biography?: string } }[] }
}

export function toPersonDetail(raw: RawPerson): PersonDetail {
  // How many people have rated the title, which is the closest thing TMDB gives
  // to "what is this person known for": a filmography in date order buries the
  // one film anyone came here for under twenty years of bit parts.
  //
  // Not `popularity`, which is trending traffic and belongs to the *title* — a
  // long-running chat show is permanently more popular than any film, so
  // sorting on it put four talk shows and Jeopardy! above every Avengers
  // picture on Scarlett Johansson's page. A four-episode "Self - Guest" credit
  // has a few hundred ratings; the films have tens of thousands.
  const all = [...raw.combined_credits?.cast ?? [], ...raw.combined_credits?.crew ?? []]
    .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))

  const credits: Media[] = []
  const seen = new Set<string>()
  for (const item of all) {
    const media = toMedia(item)
    // Credited twice on one title (acted in it and produced it) is one card.
    if (!media || seen.has(`${media.type}-${media.id}`))
      continue
    seen.add(`${media.type}-${media.id}`)
    credits.push(media)
  }

  return {
    id: raw.id,
    name: raw.name ?? '',
    // A biography is the one field TMDB does *not* fall back to English on: a
    // language it has no translation in answers with an empty string, which is
    // 33 of the app's languages showing a blank page. The English one is asked
    // for alongside and stands in — see `translations` in the append below.
    biography: raw.biography
      || raw.translations?.translations.find(t => t.iso_639_1 === 'en')?.data?.biography
      || '',
    birthday: raw.birthday ?? '',
    deathday: raw.deathday ?? '',
    birthplace: raw.place_of_birth ?? '',
    profile: raw.profile_path ?? null,
    credits,
  }
}

/** Never blocks navigation — the page renders its skeleton while this resolves. */
export function usePerson(id: MaybeRefOrGetter<string | number>) {
  return useAsyncData(
    () => `person-${toValue(id)}`,
    () => tmdb<RawPerson>(`/person/${toValue(id)}`, { append_to_response: 'combined_credits,translations' }),
    { lazy: true, watch: [() => toValue(id)], transform: toPersonDetail },
  )
}
