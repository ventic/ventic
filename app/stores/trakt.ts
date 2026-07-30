import type { Media, MediaType, TmdbItem } from '~/utils/tmdb'
import type { DeviceCode, RemoteTitle, TraktLimits, TraktList, TraktTokens } from '~/utils/trakt'
// @vueuse/nuxt auto-imports composables, not consts — this one needs asking for.
import { StorageSerializers } from '@vueuse/core'

/**
 * How long a sync is considered fresh. Short, because the only thing that gets
 * past this gate is the app being launched or brought back to the front — a
 * device picked up minutes after the other one was put down is the whole point,
 * and waiting hours to notice reads as the sync being broken.
 */
const STALE_AFTER = 15 * 60_000

/** TMDB answers 429 to a burst, so a fresh device's whole history can't go at once. */
const HYDRATE_AT_ONCE = 8

/** Renewed a day out, so a token never expires mid-play. */
const RENEW_BEFORE = 86_400_000

/**
 * Trakt, if the user connects one. Everything still works without it — this is
 * the library's second copy, not its home.
 *
 * Both directions are wired through the library store's own writes
 * (`record`, `finish`, `setWatched`, `toggleFavourite`, `toggleWatchlist`), so
 * there is no second set of call sites to keep in step and nothing to remember
 * when a new button marks something watched.
 */
export const useTraktStore = defineStore('trakt', () => {
  const config = useRuntimeConfig().public
  setTraktApp(String(config.TRAKT_ID ?? ''), String(config.TRAKT_SECRET ?? ''))

  /**
   * Deliberately outside the backup file (see utils/backup): a bearer token in
   * something meant to be copied between machines is a credential you can't
   * take back. Signing in again is six digits.
   */
  const tokens = useLocalStorage<TraktTokens | null>('ventic.trakt', null, { serializer: StorageSerializers.object })
  const who = useLocalStorage('ventic.traktUser', '')
  const lastSync = useLocalStorage('ventic.traktSyncedAt', 0)

  /**
   * What Trakt will hold for this account. Kept here so the pages can say why a
   * list has stopped syncing without a request every time one is opened — and 0
   * until a sync has asked, which reads as "no cap known" and warns nobody.
   */
  const limits = useLocalStorage<TraktLimits>('ventic.traktLimits', { watchlist: 0, favorites: 0 })

  /** Shown while the device flow waits for the code to be typed in. */
  const code = ref<DeviceCode | null>(null)
  const syncing = ref(false)
  const error = ref('')
  const note = ref('')

  const available = computed(() => traktConfigured())
  const signedIn = computed(() => !!tokens.value?.access)

  /**
   * How far past Trakt's cap a list is, or 0. Local lists are never capped, so
   * this is the whole of what being over means: the entries past the line live
   * on this device and Trakt never gets them.
   */
  function over(list: TraktList, count: number) {
    return signedIn.value ? overLimit(limits.value[list], count) : 0
  }

  function disconnect() {
    tokens.value = null
    who.value = ''
    lastSync.value = 0
    code.value = null
    // The next account's caps are its own, and nothing may warn about a list
    // there is no longer an account to sync.
    limits.value = { watchlist: 0, favorites: 0 }
  }

  /** A usable access token, renewed if it is close to running out. */
  async function auth() {
    const held = tokens.value
    if (!held)
      throw new Error('Not signed in to Trakt.')
    if (held.expires - Date.now() > RENEW_BEFORE)
      return held.access

    try {
      const fresh = await refreshTokens(held.refresh)
      tokens.value = fresh
      return fresh.access
    }
    catch {
      // Revoked on trakt.tv, or the refresh token outlived its own window.
      // Nothing here can recover it, and pretending otherwise fails every call.
      disconnect()
      throw new Error('The Trakt sign-in expired. Connect again.')
    }
  }

  // --- Signing in -------------------------------------------------------------

  /**
   * The device flow: Trakt hands back a short code, the user types it on
   * trakt.tv from any device, and this polls until it lands. No redirect URI, no
   * loopback server, and it reads the same on a TV as on a laptop.
   */
  async function connect() {
    error.value = ''
    note.value = ''
    let mine: DeviceCode
    try {
      mine = await deviceCode()
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return
    }
    code.value = mine

    const deadline = Date.now() + mine.expires_in * 1000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, Math.max(1, mine.interval) * 1000))
      // Cancelled, or a second attempt started while this one waited. Compared
      // by device_code, not identity: `code.value` hands back a reactive proxy
      // of `mine`, so `!==` is true even when nothing changed — and this loop
      // would return before ever polling.
      if (code.value?.device_code !== mine.device_code)
        return

      try {
        const got = await deviceToken(mine.device_code)
        if (!got)
          continue
        tokens.value = got
        code.value = null
        who.value = await username(got.access).catch(() => 'Trakt')
        await sync(true)
        return
      }
      catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
        code.value = null
        return
      }
    }

    code.value = null
    error.value = 'The code expired before it was entered.'
  }

  function cancel() {
    code.value = null
  }

  // --- Pushing ----------------------------------------------------------------

  /**
   * Nothing here may ever interrupt playback or a button press, so every push
   * swallows its failure into `error` for the settings page to show. A sync
   * that didn't happen is worth saying; it is not worth a dialog over the film.
   */
  async function push(work: (token: string) => Promise<void>) {
    if (!signedIn.value)
      return
    try {
      await work(await auth())
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /**
   * What Trakt was last told, so a progress tick every two seconds isn't a
   * request every two seconds. Trakt wants three events for a play, not nine
   * hundred, and it rate-limits accordingly.
   */
  let sent = { key: '', action: '' }

  /**
   * Called from the library store's `record`. `stop` is the event that decides
   * whether Trakt files this as watched or as a resume point, so it is the one
   * that must not be skipped; `pause` only keeps its "watching now" honest.
   */
  function playing(m: Media, season: number, episode: number, position: number, duration: number, event: PlayEvent) {
    if (!signedIn.value || !duration)
      return
    const body = playedBody(m, season, episode)
    if (!body)
      return

    const key = progressKey(m.type, m.id, season, episode)
    const action = scrobbleAction(event)
    // Pausing or stopping something Trakt was never told about says nothing
    // about it — and would have Trakt open a scrobble just to close it.
    if (event !== 'tick' && sent.key !== key)
      return
    if (sent.key === key && sent.action === action)
      return

    // A stop ends the play; a pause does not, so resuming has to be able to send
    // `start` again — which it does, because the last action recorded is `pause`.
    sent = event === 'stop' ? { key: '', action: '' } : { key, action }
    push(token => scrobble(action, body, (position / duration) * 100, token))
  }

  /**
   * Watched marks made by hand, collected before they are sent. "Mark the
   * earlier episodes too" is one gesture that calls this once per episode, and
   * Trakt takes the whole season in a single nested request — see `historyBody`.
   */
  const queued = { add: [] as object[], remove: [] as object[] }
  let flush: ReturnType<typeof setTimeout> | null = null

  function marked(m: Pick<Media, 'id' | 'type'>, watched: boolean, season: number, episode: number) {
    const body = playedBody(m, season, episode)
    if (!body || !signedIn.value)
      return

    queued[watched ? 'add' : 'remove'].push(body)
    if (flush)
      clearTimeout(flush)
    // Long enough for a loop over a season to land in one batch, short enough
    // that a single tick still reaches Trakt while the user is looking at it.
    flush = setTimeout(() => {
      flush = null
      for (const add of [true, false] as const) {
        const batch = queued[add ? 'add' : 'remove'].splice(0)
        if (batch.length)
          push(token => historyChange(add, historyBody(batch), token))
      }
    }, 400)
  }

  function listed(list: TraktList, m: Pick<Media, 'id' | 'type'>, add: boolean) {
    push(token => listChange(list, add, listBody(m), token))
  }

  // --- Pulling ----------------------------------------------------------------

  /**
   * A title Trakt named that has never been opened here has no poster, no title
   * and no runtime on this device — so the rows that would list it drop it, and
   * a percentage can't be turned into a resume point. One TMDB detail per title
   * fills in all three.
   *
   * `runtimeFor` is the handful of resume points, which need a runtime even when
   * the title is already known here. Everything else is fetched only if this
   * device has never seen it: a watched history is every show the account has
   * ever touched, and re-fetching the lot on each launch is hundreds of requests
   * for details already in localStorage.
   */
  async function hydrate(titles: { type: MediaType, id: number }[], runtimeFor: Set<string>) {
    const library = useLibraryStore()
    const runtimes = new Map<string, number>()
    const wanted = new Map(titles.map(t => [titleKey(t.type, t.id), t]))
    const todo = [...wanted].filter(([key]) => runtimeFor.has(key) || !library.media[key])

    // One iterator, shared: the workers below take from the same queue rather
    // than each walking the whole list.
    const queue = todo[Symbol.iterator]()
    await Promise.all(Array.from({ length: HYDRATE_AT_ONCE }, async () => {
      for (const [key, t] of queue) {
        const raw = await tmdb<TmdbItem & { runtime?: number, episode_run_time?: number[] }>(`/${t.type}/${t.id}`)
          .catch(() => null)
        if (!raw)
          continue
        // Movie length, or a show's typical episode length — which is as good as
        // this gets without a request per episode.
        const minutes = raw.runtime || raw.episode_run_time?.[0] || 0
        if (minutes)
          runtimes.set(key, minutes * 60)
        const media = toMedia(raw, t.type)
        if (media && !library.media[key])
          library.remember(media)
      }
    }))

    return runtimes
  }

  /** Seconds to resume at, from a play here if there was one, or TMDB's runtime. */
  function secondsFor(t: RemoteTitle & { percent: number }, runtimes: Map<string, number>) {
    const library = useLibraryStore()
    const duration = library.progress[t.key]?.duration || runtimes.get(titleKey(t.type, t.id)) || 0
    return { duration, position: (duration * t.percent) / 100 }
  }

  /**
   * Everything Trakt knows that this device doesn't. Watched marks first (they
   * need nothing but ids), then the two lists and the resume points, which need
   * a TMDB round trip each to be worth anything.
   */
  async function sync(force = false) {
    if (!signedIn.value || syncing.value)
      return
    if (!force && Date.now() - lastSync.value < STALE_AFTER)
      return

    syncing.value = true
    error.value = ''
    note.value = ''
    try {
      const token = await auth()
      const library = useLibraryStore()

      const [[movies, shows], playback, wanted, loved, caps] = await Promise.all([
        fetchWatched(token),
        fetchPlayback(token).catch(() => []),
        fetchList('watchlist', token).catch(() => [[], []]),
        fetchList('favorites', token).catch(() => [[], []]),
        // Only ever used to explain a full list, so a refusal here costs the
        // banner, not the sync.
        fetchLimits(token).catch(() => null),
      ])

      if (caps)
        limits.value = caps

      const marks = watchedTitles(movies, shows)
      const watched = mergeWatched(library.progress, marks)
      library.absorb(watched.merged)

      const list = listedTitles(wanted[0], wanted[1])
      const faves = listedTitles(loved[0], loved[1])
      const points = playbackTitles(playback)
      // The watched marks are hydrated too, and that is not an optimisation: the
      // rows draw from the card snapshot map, so absorbing a mark without fetching
      // its title leaves a placeholder where the poster should be.
      const runtimes = await hydrate(
        [...list, ...faves, ...points, ...marks],
        new Set(points.map(p => titleKey(p.type, p.id))),
      )

      library.absorbList('watchlist', list.map(t => t.key))
      library.absorbList('favorites', faves.map(t => t.key))
      const resumed = mergeProgress(
        library.progress,
        points.map(p => ({ key: p.key, at: p.at, ...secondsFor(p, runtimes) })),
      )
      library.absorb(resumed.merged)

      lastSync.value = Date.now()
      note.value = `Synced: ${watched.added} watched, ${resumed.added} to carry on with, `
        + `${list.length} on the watchlist, ${faves.length} favourites.`
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    finally {
      syncing.value = false
    }
  }

  /**
   * Brought back to the front. app.vue's sync runs once per page load, which on
   * Android is once per *cold* start: coming back to a frozen process resumes the
   * same webview, so without this the app that has been open on the sofa for a
   * week never pulls again — which is what "the phone is missing everything"
   * looks like. Unforced, so the staleness gate still owns how often.
   */
  const visibility = useDocumentVisibility()
  watch(visibility, now => {
    if (now === 'visible')
      sync()
  })

  return {
    available,
    signedIn,
    who,
    lastSync,
    limits,
    over,
    code,
    syncing,
    error,
    note,
    connect,
    cancel,
    disconnect,
    sync,
    playing,
    marked,
    listed,
  }
})
