/**
 * Offline mode's two chores (see utils/offline and utils/shelf): the saved
 * pictures to hand before any page asks for one, and downloads still missing
 * their subtitles asked for again when there is a network — once the engine
 * has said what it holds, and on getting a network back.
 */
export default defineNuxtPlugin(() => {
  loadImages()
  const downloads = useDownloadsStore()
  watch([() => downloads.loaded, online], ([loaded, up]) => {
    if (loaded && up)
      downloads.catchUp()
  }, { immediate: true })
})
