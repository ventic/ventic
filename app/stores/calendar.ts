import type { RawSchedule, Schedule } from '~/utils/calendar'

/** A schedule older than this is asked for again. */
const TTL = 6 * 3600_000

/** How many shows are asked about at once. */
const PARALLEL = 4

/**
 * The episode calendar's data: each followed show's last and next episode, as
 * TMDB has them. In memory only, a request per show at most every six hours —
 * a cache under a `ventic.` key would travel in every backup and every sync
 * for nothing, and a day-old schedule is the one thing a calendar must not show.
 *
 * Everything about *what* the rows are is utils/calendar.ts.
 */
export const useCalendarStore = defineStore('calendar', () => {
  const library = useLibraryStore()

  const schedules = ref<Record<number, Schedule & { at: number }>>({})
  const loading = ref(false)
  /** Read on every refresh, so a calendar left open overnight turns over. */
  const today = ref(localDay())

  const followed = computed(() => followedShows(library.progress, library.favourites, library.watchlist))

  async function refresh() {
    if (loading.value)
      return
    loading.value = true
    today.value = localDay()
    try {
      const stale = followed.value.filter(id => Date.now() - (schedules.value[id]?.at ?? 0) > TTL)
      // A few at a time: a library of sixty shows is sixty requests, and TMDB
      // answers a burst of them with 429s.
      const queue = [...stale]
      await Promise.all(Array.from({ length: PARALLEL }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          const raw = await tmdb<RawSchedule>(`/tv/${id}`).catch(() => null)
          if (raw)
            schedules.value[id] = { ...toSchedule(raw), at: Date.now() }
        }
      }))
    }
    finally {
      loading.value = false
    }
  }

  const rows = computed(() => arrangeCalendar(
    followed.value.flatMap(id => schedules.value[id] ?? []),
    today.value,
    (show, season, episode) => !!library.episodeProgress(show, season, episode)?.watched,
  ))

  const freshShows = computed(() => new Set(rows.value.fresh.map(a => a.show)))

  /** The badge on a show's card: an episode out this week that hasn't been watched. */
  function isNew(showId: number | string) {
    return freshShows.value.has(Number(showId))
  }

  // --- Air-day notifications -------------------------------------------------

  /** Episodes already announced, so a relaunch on the same day says nothing twice. */
  const announced = useLocalStorage<Record<string, string>>(scoped('ventic.airNotified'), {})

  /**
   * Tell the desktop about what came out today. Opt-in (`settings.airNotify`),
   * and the desktop's alone: on Android the process is frozen whenever the app
   * isn't on screen, so a notice could only arrive while you are looking at the
   * calendar that already says it.
   */
  async function announce() {
    const settings = useSettingsStore()
    if (!settings.airNotify || !isDesktop())
      return
    const due = [...rows.value.fresh, ...rows.value.today].filter(a => a.air === today.value && !announced.value[airingKey(a)])
    if (!due.length)
      return
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
      if (!await isPermissionGranted() && await requestPermission() !== 'granted')
        return
      for (const a of due) {
        sendNotification({
          title: a.showName,
          body: $t('S{season} E{episode} is out today', { season: a.season, episode: a.episode }) + (a.name ? ` · ${a.name}` : ''),
        })
        announced.value[airingKey(a)] = a.air
      }
      // Kept to the last week: one entry per episode for ever is a slow leak.
      for (const [key, day] of Object.entries(announced.value)) {
        if (daysBetween(day, today.value) > 7)
          delete announced.value[key]
      }
    }
    catch {
      // Not under Tauri, or the plugin refused — the calendar still says it.
    }
  }

  return { schedules, loading, today, followed, refresh, rows, isNew, announce }
})
