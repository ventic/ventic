import type { Progress } from '~/utils/library'
import type { Media } from '~/utils/tmdb'
import type { PlayEvent, TraktList } from '~/utils/trakt'

/**
 * Everything the app remembers about what you have watched: progress, watched
 * marks, history, favourites and the watchlist. Local first — a connected Trakt
 * account is a second copy of this, never the source of it, so everything below
 * works the same with nothing signed in, and nothing here is capped by what
 * Trakt would accept.
 *
 * Every write reports itself to `stores/trakt`, which is why there is no second
 * set of call sites to keep in step: a new button that marks something watched
 * syncs by going through here, like every existing one already does.
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
   * They are separate on Trakt and separate here: a favourite is something you
   * loved, the watchlist is something you mean to get to.
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
    if (known?.title !== m.title || known?.poster !== m.poster)
      media.value[key] = slim(m)
  }

  // --- Reads -----------------------------------------------------------------

  function episodeProgress(showId: number | string, season: number, episode: number) {
    return progress.value[progressKey('tv', showId, season, episode)]
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

  /**
   * Whether the favourite button does anything. Trakt only favourites what you
   * have watched, so an unwatched title would be a local entry that could never
   * sync — the watchlist is what "I mean to get to" is for. Taking one *off*
   * is never gated: an entry that arrived from Trakt, or predates this rule,
   * still has to be removable.
   */
  function canFavourite(m: Pick<Media, 'id' | 'type'>) {
    return isFavourite(m) || watchedTitle(progress.value, m.type, m.id)
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
    continuing(progress.value).map(e => ({ ...e, media: media.value[e.title] ?? placeholder(e.title) })))

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
   *
   * `event` exists for Trakt's sake, which wants to be told about a play rather
   * than sampled: `stop` is what decides whether this is filed as watched or as
   * somewhere to pick up from, and `pause` is what keeps its "watching now" from
   * going stale while the film is halted. Neither can be inferred from position.
   */
  function record(m: Media, season: number, episode: number, position: number, duration: number, event: PlayEvent = 'tick') {
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
    useTraktStore().playing(m, season, episode, position, duration, event)
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
    // Played right out — 100%, whatever duration mpv did or didn't report, so
    // Trakt files this as watched rather than as a resume point.
    useTraktStore().playing(m, season, episode, 1, 1, 'stop')
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
    useTraktStore().marked(m, watched, season, episode)
  }

  function toggleWatched(m: Media | Pick<Media, 'id' | 'type'>, season = 0, episode = 0) {
    const key = progressKey(m.type, m.id, season, episode)
    setWatched(m, !progress.value[key]?.watched, season, episode)
  }

  /**
   * Both list buttons. Being over Trakt's cap is never a reason to refuse the
   * entry — that is a thing to say on the page (ListLimit.vue) and nothing
   * else. Not having watched it is: see `canFavourite`.
   */
  function toggle(list: TraktList, m: Media) {
    // Every favourite button routes through here, so the watched rule is
    // enforced once rather than at each of them.
    if (list === 'favorites' && !canFavourite(m))
      return
    const store = list === 'favorites' ? favourites : watchlist
    const key = titleKey(m.type, m.id)
    const add = !(key in store.value)
    if (add)
      store.value[key] = Date.now()
    else
      delete store.value[key]
    remember(m)
    useTraktStore().listed(list, m, add)
  }

  const toggleFavourite = (m: Media) => toggle('favorites', m)
  const toggleWatchlist = (m: Media) => toggle('watchlist', m)

  /** Settings → Storage: forget the lot. */
  function clear() {
    media.value = {}
    progress.value = {}
    favourites.value = {}
    watchlist.value = {}
  }

  // --- Absorbing another device's copy ----------------------------------------
  // Written by stores/trakt after `utils/trakt` has decided which of two records
  // of the same episode wins. Kept as plain assignment of an already-merged map:
  // merging in two places is how the two disagree.

  function absorb(next: Record<string, Progress>) {
    progress.value = next
  }

  /**
   * Titles on one of Trakt's lists that aren't on the local copy. Additions only
   * — something missing from a list on a service the user may have signed into
   * five minutes ago is not evidence that they took it off the list, and once
   * either side is past Trakt's cap the two legitimately hold different things.
   */
  function absorbList(list: TraktList, keys: string[]) {
    const store = list === 'favorites' ? favourites : watchlist
    for (const key of keys) {
      if (!(key in store.value))
        store.value[key] = Date.now()
    }
  }

  return {
    media,
    progress,
    favourites,
    watchlist,
    remember,
    absorb,
    absorbList,
    resumeRow,
    history,
    favouriteList,
    watchlistItems,
    episodeProgress,
    lastEpisode,
    cardProgress,
    cardLabel,
    isWatched,
    isFavourite,
    canFavourite,
    inWatchlist,
    resumeAt,
    resumeLink,
    record,
    finish,
    setWatched,
    toggleWatched,
    toggleFavourite,
    toggleWatchlist,
    clear,
  }
})
