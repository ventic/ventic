/**
 * When a sync happens. Nothing here decides what one *does* — see utils/sync.ts.
 *
 * A poll, because there is no server of ours to hold a connection open to. Five
 * minutes is well inside "I paused it on the telly and picked it up on the
 * laptop", and `run()` is a no-op until an address has been typed, so an install
 * that never turns this on pays nothing.
 */
export default defineNuxtPlugin(() => {
  const sync = useSyncStore()

  // First, so the app opens on what the other screen already knows.
  sync.run()
  setInterval(() => sync.run(), 5 * 60_000)

  // Android freezes the process the moment it is backgrounded, so `hidden` is
  // the last chance there to send anything at all.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden)
      sync.run()
  })

  // Leaving a film is the moment the library is most worth sending: it is the
  // one thing the other screen is waiting for, and the five-minute tick would
  // otherwise sit on it.
  useRouter().afterEach((_to, from) => {
    if (from.path === localePath('/watch'))
      sync.run()
  })
})
