import type { Progress } from '~/utils/library'
import type { Media } from '~/utils/tmdb'

/** The two lists this app keeps, both stored the same way. */
type ListName = 'favourites' | 'watchlist'

/**
 * Everything the app remembers about what you have watched: progress, watched
 * marks, history, favourites and the watchlist. This device and nothing else —
 * there is no account and no server, so `utils/backup.ts` is how a library
 * moves between machines.
 *
 * Four flat records in localStorage rather than a database. A card
 * snapshot is ~300 bytes, so the 5MB budget holds roughly ten thousand of them;
 * add pruning the day someone actually fills it.
 */
export const useLibraryStore = defineStore('library', () => {
  /**
   * Poster and title for every id below, so History, Favourites and Watchlist
   * render without asking TMDB for a hundred titles one at a time. Keyed by
   * titleKey.
   */
  const media = useLocalStorage<Record<string, Media>>('ventic.media', {})
  /** Keyed by progressKey — one entry per movie and per episode. */
  const progress = useLocalStorage<Record<string, Progress>>('ventic.progress', {})

  /**
   * Two lists, both titleKey -> when it was added, newest first when sorted.
   * Kept apart on purpose: a favourite is something you loved, the watchlist is
   * something you mean to get to.
   */
  const favourites = useLocalStorage<Record<string, number>>('ventic.favourites', {})
  const watchlist = useLocalStorage<Record<string, number>>('ventic.watchlist', {})

  // Rewritten only when something visible changed: `record` calls this every
  // couple of seconds, and a fresh object every time would rewrite the whole
  // map to localStorage on each tick.
  function remember(m: Media | Pick<Media, 'id' | 'type'>) {
    // An episode row marked by hand may know the show's id and nothing else;
    // keep whatever snapshot is already stored rather than blanking it.
    //
    // A placeholder card is the same case wearing a title: favouriting one would
    // store the stand-in as though it were a real detail, and the next sync would
    // then skip the fetch that fills it in — for good.
    if (!('title' in m) || m.title === UNKNOWN_TITLE)
      return
    const key = titleKey(m.type, m.id)
    const known = media.value[key]
    // The language clause backfills snapshots stored before it was kept — it is
    // what tells an anime apart from any other cartoon (see `kindOf`); the
    // seasons one does the same for the episode counts "Continue watching"
    // rolls over on, which only a detail response ever carries.
    if (known?.title !== m.title || known?.poster !== m.poster
      || (!known?.lang && m.lang) || (!known?.seasons?.length && m.seasons?.length)) {
      media.value[key] = slim(m)
    }
  }

  // --- Reads -----------------------------------------------------------------

  function episodeProgress(showId: number | string, season: number, episode: number) {
    return progress.value[progressKey('tv', showId, season, episode)]
  }

  /** Watched episodes of one season — the bar and the tick on a season card. */
  function seasonWatched(showId: number | string, season: number) {
    return watchedInSeason(progress.value, showId, season)
  }

  /** The episode a show should pick up from, before the next-episode rollover. */
  function lastEpisode(showId: number | string) {
    const entry = showEntries(progress.value, showId)[0]
    if (!entry)
      return null
    const { season, episode } = parseKey(entry[0])
    return { season, episode, watched: entry[1].watched }
  }

  /**
   * What a card draws its bar from: a movie's own progress, or the episode of a
   * show that was played most recently.
   */
  function cardProgress(m: Pick<Media, 'id' | 'type'>): Progress | undefined {
    if (m.type === 'movie')
      return progress.value[titleKey('movie', m.id)]
    // A show marked watched by hand has no episode entry to point at.
    return showEntries(progress.value, m.id)[0]?.[1] ?? progress.value[titleKey('tv', m.id)]
  }

  /** "S2 E3" under a show's progress bar, so the bar says what it is measuring. */
  function cardLabel(m: Pick<Media, 'id' | 'type'>) {
    if (m.type !== 'tv')
      return ''
    const entry = showEntries(progress.value, m.id)[0]
    if (!entry)
      return ''
    const { season, episode } = parseKey(entry[0])
    return `S${season} E${episode}`
  }

  /**
   * The tick on a card. A movie earns it by being played out; a show only ever
   * by hand — the app can't know every episode has been seen without fetching
   * every season, and finishing one episode certainly doesn't mean it. Both
   * read the same key, because a movie's progress *is* its title entry.
   */
  function isWatched(m: Pick<Media, 'id' | 'type'>) {
    return progress.value[titleKey(m.type, m.id)]?.watched ?? false
  }

  function isFavourite(m: Pick<Media, 'id' | 'type'>) {
    return titleKey(m.type, m.id) in favourites.value
  }

  function inWatchlist(m: Pick<Media, 'id' | 'type'>) {
    return titleKey(m.type, m.id) in watchlist.value
  }

  /** Where the player should seek to, or 0 to start from the top. */
  function resumeAt(m: Pick<Media, 'id' | 'type'>, season = 0, episode = 0) {
    const p = progress.value[progressKey(m.type, m.id, season, episode)]
    return p && resumable(p.position, p.duration) ? Math.floor(p.position) : 0
  }

  /** Straight back into playback, at the episode the show is up to. */
  function resumeLink(m: Pick<Media, 'id' | 'type'>) {
    if (m.type === 'movie')
      return watchLink('movie', m.id)
    const last = lastEpisode(m.id)
    return last
      ? watchLink('tv', m.id, last.season, last.episode)
      : mediaLink(m as Media)
  }

  // A title with no card snapshot gets a placeholder rather than being left out:
  // these three are the whole of what History, Continue watching, Favourites and
  // the Watchlist render, so dropping an entry here is watch state that exists and
  // is invisible — which is what a sync looks like when it appears to do nothing.
  const resumeRow = computed(() =>
    continuing(progress.value, media.value).map(e => ({ ...e, media: media.value[e.title] ?? placeholder(e.title) })))

  const history = computed(() =>
    playedTitles(progress.value).map(key => media.value[key] ?? placeholder(key)))

  function listItems(list: Record<string, number>) {
    return Object.entries(list)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => media.value[key] ?? placeholder(key))
  }

  const favouriteList = computed(() => listItems(favourites.value))
  const watchlistItems = computed(() => listItems(watchlist.value))

  // --- Writes ----------------------------------------------------------------

  /**
   * Called by the player every couple of seconds, and again whenever playback
   * pauses or stops. Crossing the 90% mark latches `watched` on, so quitting
   * during the credits still counts — and a rewatch that starts from zero
   * clears it again.
   */
  function record(m: Media, season: number, episode: number, position: number, duration: number) {
    remember(m)
    const key = progressKey(m.type, m.id, season, episode)
    const already = progress.value[key]?.watched === true
    progress.value[key] = {
      position,
      duration,
      at: Date.now(),
      // Sticky, so scrubbing back out of the credits doesn't un-watch it — but
      // starting the file again from the top does, because that's a rewatch.
      watched: finished(position, duration) || (already && (!duration || position > duration * 0.05)),
    }
  }

  /** mpv reached the end of the file — the clearest "watched" signal there is. */
  function finish(m: Media, season = 0, episode = 0) {
    remember(m)
    const key = progressKey(m.type, m.id, season, episode)
    const previous = progress.value[key]
    const duration = previous?.duration ?? 0
    progress.value[key] = {
      position: duration || previous?.position || 0,
      duration,
      at: Date.now(),
      watched: true,
    }
  }

  function setWatched(m: Media | Pick<Media, 'id' | 'type'>, watched: boolean, season = 0, episode = 0) {
    remember(m)
    const key = progressKey(m.type, m.id, season, episode)
    const previous = progress.value[key]
    if (watched) {
      // Marking it by hand means the bar is full.
      progress.value[key] = {
        position: previous?.duration ?? 0,
        duration: previous?.duration ?? 0,
        at: Date.now(),
        watched: true,
      }
    }
    else {
      // Unmarking means it never happened: History is every title with a row in
      // this map, so a zeroed row left behind keeps the title listed — and its
      // fresh `at` would sort it to the top on the way out.
      delete progress.value[key]
    }
  }

  /**
   * A whole season at once, from the season card. The episode count comes from
   * TMDB's season list, so nothing has to fetch the season to mark it — and the
   * one-per-episode keys are the same ones an episode row writes.
   */
  function markSeason(m: Media | Pick<Media, 'id' | 'type'>, season: number, episodes: number, watched: boolean) {
    for (let n = 1; n <= episodes; n++)
      setWatched(m, watched, season, n)
  }

  function toggleWatched(m: Media | Pick<Media, 'id' | 'type'>, season = 0, episode = 0) {
    const key = progressKey(m.type, m.id, season, episode)
    setWatched(m, !progress.value[key]?.watched, season, episode)
  }

  /** Both list buttons: nothing is capped, so this only ever flips membership. */
  function toggle(list: ListName, m: Media) {
    const store = list === 'favourites' ? favourites : watchlist
    const key = titleKey(m.type, m.id)
    if (key in store.value)
      delete store.value[key]
    else
      store.value[key] = Date.now()
    remember(m)
  }

  const toggleFavourite = (m: Media) => toggle('favourites', m)
  const toggleWatchlist = (m: Media) => toggle('watchlist', m)

  /** Settings → Storage: forget the lot. */
  function clear() {
    media.value = {}
    progress.value = {}
    favourites.value = {}
    watchlist.value = {}
  }

  return {
    media,
    progress,
    favourites,
    watchlist,
    remember,
    resumeRow,
    history,
    favouriteList,
    watchlistItems,
    episodeProgress,
    seasonWatched,
    lastEpisode,
    cardProgress,
    cardLabel,
    isWatched,
    isFavourite,
    inWatchlist,
    resumeAt,
    resumeLink,
    record,
    finish,
    setWatched,
    markSeason,
    toggleWatched,
    toggleFavourite,
    toggleWatchlist,
    clear,
  }
})
