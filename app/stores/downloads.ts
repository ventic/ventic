import type { DiskSpace, EngineTorrent } from '~/utils/torrents'
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiFormatListBulleted, mdiPauseCircleOutline, mdiTrayArrowDown } from '@mdi/js'
import { invoke } from '@tauri-apps/api/core'

export type StatusKey = 'downloading' | 'done' | 'paused' | 'error' | 'checking'
export type FilterKey = 'all' | StatusKey

/** Chip label + colour for whatever the engine says a torrent is doing. */
export const TORRENT_STATUS: Record<StatusKey, { text: () => string, color: string }> = {
  downloading: { text: () => $t('Downloading'), color: 'primary' },
  done: { text: () => $t('Completed'), color: 'success' },
  paused: { text: () => $t('Paused'), color: 'warning' },
  checking: { text: () => $t('Metadata'), color: 'info' },
  error: { text: () => $t('Error'), color: 'error' },
}

/** The left rail, qBittorrent-style: one row per state with a live count. */
// `title` is a function for the same reason SECTIONS' is: this list is built
// when the module loads, before `$t` has a locale to read — and the label has
// to change when the language does.
export const FILTERS: { value: FilterKey, title: () => string, icon: string }[] = [
  { value: 'all', title: () => $t('All'), icon: mdiFormatListBulleted },
  { value: 'downloading', title: () => $t('Downloading'), icon: mdiTrayArrowDown },
  { value: 'done', title: () => $t('Completed'), icon: mdiCheckCircleOutline },
  { value: 'paused', title: () => $t('Paused'), icon: mdiPauseCircleOutline },
  { value: 'error', title: () => $t('Errored'), icon: mdiAlertCircleOutline },
]

export function torrentStatus(t: EngineTorrent): StatusKey {
  const s = t.stats
  if (s?.error)
    return 'error'
  if (s?.state === 'paused')
    return 'paused'
  if (s?.finished)
    return 'done'
  if (!s || s.state === 'initializing')
    return 'checking'
  return 'downloading'
}

export function percentOf(t: EngineTorrent) {
  const s = t.stats
  return s?.total_bytes ? Math.min(100, (s.progress_bytes / s.total_bytes) * 100) : 0
}

export const useDownloadsStore = defineStore('downloads', () => {
  /** Rate ceilings and the storage folder are the user's, not ours. */
  const settings = useSettingsStore()
  const torrents = ref<EngineTorrent[]>([])
  const offline = ref(false)
  const loaded = ref(false)
  let lastFail = 0

  /**
   * When each torrent was last played, or first seen if it never was. Drives
   * eviction, so it outlives the session; pruned to what the engine still holds
   * so a re-added title doesn't inherit the timestamp of the copy we deleted.
   */
  const touched = useLocalStorage<Record<string, number>>('ventic.touched', {})

  /**
   * Which torrent, and which file inside it, a title was last played from —
   * keyed the way watch progress is (`movie:603`, `tv:1396:2:3`). A finished
   * one plays straight off the disk: no TMDB, no sources, no peers. That is all
   * "offline" is here, so it outlives the session and is pruned to what the
   * engine still holds.
   */
  const cached = useLocalStorage<Record<string, { hash: string, file: number }>>('ventic.cached', {})

  function cachedFor(key: string) {
    return (key && cached.value[key]) || null
  }

  /** User's own ceiling on the cache, in bytes. 0 = whatever the disk allows. */
  const cap = useLocalStorage('ventic.storageCap', 0)

  const disk = ref<DiskSpace | null>(null)
  const used = computed(() => usedBytes(torrents.value))
  const budget = computed(() => diskBudget(disk.value, used.value, cap.value))

  /**
   * Largest single file the storage folder will take, `Infinity` when nothing
   * caps it — a FAT32 stick in a TV stops at 4 GiB (see `storageVolumes`).
   *
   * Separate from `budget` on purpose: the budget is how much of the disk the
   * cache may fill and is what eviction works against, while this is a ceiling
   * on one file that no amount of deleting will raise.
   */
  const fileLimit = ref(Number.POSITIVE_INFINITY)

  /** The torrent being watched: never evicted, and the only one downloading. */
  const focused = ref<number | null>(null)
  /** What `focus` paused, so `release` can put it back. */
  let paused: number[] = []

  /**
   * Drop what the engine no longer holds. Only ever called with a list the
   * engine actually answered with: pruning against the empty list an offline
   * engine leaves behind would throw away every play time and every cached
   * copy, so a slow-starting engine would cost the whole eviction order.
   */
  function prune() {
    const seen = torrents.value.map(t => t.info_hash)
    // Rebuilt only when it would really change — this runs every two seconds,
    // and a fresh object each tick rewrites the whole map to localStorage.
    if (seen.length !== Object.keys(touched.value).length || seen.some(hash => !touched.value[hash]))
      touched.value = Object.fromEntries(seen.map(hash => [hash, touched.value[hash] ?? Date.now()]))

    for (const [key, entry] of Object.entries(cached.value)) {
      if (!seen.includes(entry.hash))
        delete cached.value[key]
    }
  }

  async function refresh() {
    try {
      torrents.value = await listTorrents()
      offline.value = false
      prune()
    }
    catch {
      offline.value = true
      lastFail = Date.now()
    }
    finally {
      loaded.value = true
    }
  }

  /**
   * Start something for a title and remember what it turned out to be, so the
   * next play can go straight to that copy. Every Play and Download button in
   * the app comes through here — `startTorrent` on its own has no idea what
   * title it is fetching.
   */
  async function start(key: string, options: Parameters<typeof startTorrent>[0]) {
    // Both ceilings are on the same quantity — the size of the file we'd fetch —
    // so the tighter one wins and `pickBest` needs to know nothing about drives.
    const maxBytes = Math.min(budget.value, fileLimit.value)
    const started = await startTorrent({ maxBytes, cached: cachedFor(key), ...options })
    // A direct link leaves nothing on the disk to come back to, so there is no
    // offline copy to file — and filing an empty hash would shadow a real one.
    if (key && started.hash)
      cached.value[key] = { hash: started.hash, file: started.index }
    return started
  }

  /**
   * Delete the least recently played torrents once the cache is over budget.
   * Runs on the poll rather than before each add: it then also covers torrents
   * resumed from a previous session, downloads that outgrew their estimate, and
   * a disk that filled up behind our back.
   */
  async function evict() {
    const drop = planEviction(torrents.value, budget.value, focused.value, touched.value)
    if (!drop.length)
      return
    // `delete` (not `forget`) — the point is the bytes.
    await Promise.all(drop.map(id => torrentAction(id, 'delete').catch(() => {})))
  }

  /**
   * Mobile data or a metered hotspot, as Android sees it (`meteredNetwork`).
   * Always false where nothing can tell, so the setting below is a no-op on
   * desktop rather than a guess.
   */
  const metered = ref(false)

  /** Torrents `meter` stopped, so Wi-Fi coming back starts exactly those. */
  let held: number[] = []

  /**
   * Keep downloads off a metered connection when the user asked for that.
   *
   * It can only run while this page can run — off screen the process
   * is frozen the moment the last download pauses (that is what stops the data
   * from flowing at all, see Downloads.kt), so a phone that reaches Wi-Fi in
   * someone's pocket resumes when the app is next opened, not before. Waking up
   * on a network change needs a JobScheduler job on the Android side, and a
   * download that waited for you to open the app has cost nobody anything.
   */
  async function meter() {
    metered.value = meteredNetwork() ?? false
    const running = torrents.value
      .filter(t => ['downloading', 'checking'].includes(torrentStatus(t)))
      .map(t => t.id)

    const plan = planNetwork(running, focused.value, held, settings.wifiOnly && metered.value)
    held = plan.held
    if (!plan.pause.length && !plan.start.length)
      return

    await Promise.all([
      ...plan.pause.map(id => torrentAction(id, 'pause').catch(() => {})),
      ...plan.start.map(id => torrentAction(id, 'start').catch(() => {})),
    ])
    await refresh()
  }

  // The poll below is throttled to about once a minute once the app is off
  // screen, which is exactly where walking out of the house lands. This event
  // fires regardless of that, so the switch to mobile data costs seconds of data
  // rather than a minute of it.
  useEventListener(() => (navigator as unknown as { connection?: EventTarget }).connection ?? null, 'change', meter)

  const visibility = useDocumentVisibility()

  /**
   * Nothing worth asking about: the window is hidden and nothing is moving.
   * Minimised or on a TV with the screen off, that's the app's whole idle cost.
   *
   * Still downloading is a different matter — eviction runs off this poll, so a
   * hidden window that stopped ticking would let a background download fill the
   * disk with nobody watching it.
   */
  function dormant() {
    return visibility.value === 'hidden'
      && !torrents.value.some(t => ['downloading', 'checking'].includes(torrentStatus(t)))
  }

  // One poll for the whole app — the toolbar badge, the sidebar counts
  // and the page all read this list. It backs off while the engine is down so a
  // browser-only dev session isn't hammering a dead port twice a second.
  useIntervalFn(
    async () => {
      if (dormant())
        return
      if (offline.value && Date.now() - lastFail <= 10_000)
        return
      await refresh()
      await evict()
      await meter()
    },
    2000,
    { immediateCallback: true },
  )

  // Free space moves on its own (other apps, other users), so it's re-read
  // rather than tracked. Failure leaves `disk` null, which means no budget and
  // no eviction — that's also the browser-only dev case, where invoke throws.
  useIntervalFn(
    // The budget has to follow the storage folder: moved to another drive, it's
    // that drive's free space that decides what gets evicted.
    async () => {
      // Same reasoning as above, and the same exception: the budget eviction
      // works from has to stay current for as long as anything is downloading.
      if (dormant())
        return
      disk.value = await invoke<DiskSpace>('disk_space', { path: settings.downloadDir || null }).catch(() => null)
      // Rides along with the free-space poll: the cap belongs to the drive, so
      // it has to follow the storage folder from one to the other exactly as
      // the budget does. Only Android reports one.
      const volumes = storageVolumes()
      // No folder chosen means the engine's default, which sits on the volume
      // Android lists first — built-in storage.
      const drive = settings.downloadDir
        ? volumes?.find(v => v.path === settings.downloadDir)
        : volumes?.[0]
      fileLimit.value = drive?.maxFile || Number.POSITIVE_INFINITY
    },
    10_000,
    { immediateCallback: true },
  )

  /**
   * Playback owns the downlink: every other *download* pauses so the whole pipe
   * goes to the stream, and is put back on `release`. Finished torrents keep
   * seeding — they cost no download bandwidth, and `uploadLimit` already holds
   * their upload down to a quarter of the line while anyone is watching.
   *
   * `id` is -1 while a direct link is playing. The engine has never heard of it,
   * but the downlink is just as busy, so everything else still gets out of the way.
   */
  async function focus(id: number) {
    await release()
    focused.value = id

    const playing = torrents.value.find(t => t.id === id)
    if (playing)
      touched.value[playing.info_hash] = Date.now()

    // A finished torrent asks the network for nothing, so nothing has to get
    // out of its way: playing off the disk leaves background downloads running.
    if (playing?.stats?.finished)
      return

    paused = torrents.value
      // 'checking' too: a torrent still pulling its metadata is competing already.
      .filter(t => t.id !== id && ['downloading', 'checking'].includes(torrentStatus(t)))
      .map(t => t.id)
    await Promise.all(paused.map(other => torrentAction(other, 'pause').catch(() => {})))
    if (playing)
      await torrentAction(id, 'start').catch(() => {}) // it may have been paused
    await refresh()
  }

  /**
   * Leaving the player stops the download it started — an unwatched torrent has
   * no reason to keep pulling. A finished one is left seeding: it costs no
   * download bandwidth and the downloads page can't resume it (its pause button
   * is disabled once complete).
   *
   * A background download you also watched ends up paused too. One
   * click on the downloads page fixes it; if that gets annoying, `focus` takes a
   * flag for "was already running".
   */
  async function release() {
    const id = focused.value
    const restore = paused
    focused.value = null
    paused = []
    if (id == null)
      return

    // Nothing to pause when a link was playing — only the restores below apply.
    const own = torrents.value.find(t => t.id === id)
    if (own && !own.stats?.finished)
      await torrentAction(id, 'pause').catch(() => {})
    // On mobile data with Wi-Fi only asked for, what playback paused stays
    // paused — starting it here would spend the data the setting exists to save,
    // and `meter` would stop it again two seconds later anyway.
    if (settings.wifiOnly && metered.value)
      held = [...new Set([...held, ...restore])]
    else
      await Promise.all(restore.map(other => torrentAction(other, 'start').catch(() => {})))
    await refresh()
  }

  const filter = ref<FilterKey>('all')
  const query = ref('')

  const counts = computed(() => {
    const tally = { all: torrents.value.length, downloading: 0, done: 0, paused: 0, checking: 0, error: 0 }
    for (const t of torrents.value)
      tally[torrentStatus(t)]++
    return tally as Record<FilterKey, number>
  })

  /** What the badge shows: anything still working, done or not. */
  const active = computed(() => counts.value.downloading + counts.value.checking)

  const speed = computed(() => {
    const sum = (pick: (t: EngineTorrent) => number) => torrents.value.reduce((n, t) => n + pick(t), 0)
    return {
      down: sum(t => t.stats?.live?.download_speed.mbps ?? 0),
      up: sum(t => t.stats?.live?.upload_speed.mbps ?? 0),
    }
  })

  // --- Seeding -----------------------------------------------------------------
  // Downloading and never giving anything back is what gets swarms killed, so
  // finished torrents keep seeding — under a ceiling, because a saturated uplink
  // is felt everywhere else on the network.

  /** Best upload rate this line has ever managed, bytes/s. See `uploadLimit`. */
  const peakUp = useLocalStorage('ventic.peakUpload', 0)

  /**
   * Seeding runs unlimited for the first few minutes of a session so there's
   * something real to measure. It's paused for playback, which is the only time
   * the ceiling actually matters.
   *
   * One probe per launch, so a line that got faster is learned on the
   * next start. If that's too slow to adapt, re-probe on a timer while idle.
   */
  const probing = ref(true)
  useTimeoutFn(() => (probing.value = false), 5 * 60_000)

  watch(() => speed.value.up, up => (peakUp.value = Math.max(peakUp.value, up * 1024 ** 2)))

  // What the settings page asked for, in bytes/s. 0 there means "automatic".
  const MB = 1024 ** 2

  watch(
    () => [
      uploadLimit(peakUp.value, focused.value != null, probing.value, settings.upLimit * MB),
      settings.downLimit > 0 ? settings.downLimit * MB : null,
    ] as const,
    ([up, down]) => setLimits(up, down),
    { immediate: true },
  )

  // New torrents land wherever storage says; the engine keeps the folder of the
  // ones it already holds.
  watch(() => settings.downloadDir, dir => setDownloadDir(dir), { immediate: true })

  // Searching only ever hits the sources the user configured, so the list has to
  // reach utils/torrents before the first search — hence `immediate`.
  watch(() => settings.sources, urls => setSources(urls), { immediate: true, deep: true })
  watch(() => settings.quality, value => setQuality(value), { immediate: true })

  /**
   * What the sidebar rail and the filter box narrow the list to. Newest first:
   * the engine hands them back in the order they were added, and the one you
   * just started is the one you came here to look at. Sorting a column in the
   * table overrides this — it sorts what it's given, via its header accessors.
   */
  const list = computed(() => {
    const q = query.value.trim().toLowerCase()
    return torrents.value.filter(t =>
      (filter.value === 'all' || torrentStatus(t) === filter.value)
      && (!q || (t.name ?? t.info_hash).toLowerCase().includes(q)),
    // The id *is* the added-on order — the engine has no timestamp.
    ).sort((a, b) => b.id - a.id)
  })

  async function act(id: number, action: 'pause' | 'start' | 'forget' | 'delete') {
    await torrentAction(id, action)
    await refresh()
  }

  /**
   * Delete every torrent, files and all — the manual version of `evict`, for
   * when the disk is needed now. The refresh that follows lets `prune` drop the
   * play times and the offline copies along with them.
   */
  async function clearAll() {
    await Promise.all(torrents.value.map(t => torrentAction(t.id, 'delete').catch(() => {})))
    await refresh()
  }

  return {
    torrents,
    offline,
    loaded,
    refresh,
    filter,
    query,
    counts,
    active,
    speed,
    list,
    act,
    clearAll,
    disk,
    used,
    budget,
    fileLimit,
    cap,
    focused,
    focus,
    release,
    metered,
    cachedFor,
    start,
  }
})
