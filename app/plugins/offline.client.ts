/**
 * Offline mode's chores (see utils/offline and utils/shelf): the saved
 * pictures to hand before any page asks for one, downloads still missing
 * their subtitles asked for again when there is a network — once the engine
 * has said what it holds, and on getting a network back — and noticing that
 * it is back where the device never said it was gone.
 */
export default defineNuxtPlugin(() => {
  loadImages()
  const downloads = useDownloadsStore()
  watch([() => downloads.loaded, online], ([loaded, up]) => {
    if (loaded && up)
      downloads.catchUp()
  }, { immediate: true })

  // Offline because TMDB stopped answering (`tmdb`) is only undone by TMDB
  // answering again, and the offline lists ask it nothing — so ask, now and
  // then. Where the device itself says offline, its `online` event says when.
  useIntervalFn(() => !online.value && navigator.onLine && reachable(), 30_000)
})
