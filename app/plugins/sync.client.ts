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

  // Both directions, because `run` is one round trip and both directions want
  // it. Going away is the last chance to *send* anything — Android freezes the
  // process the moment it is backgrounded, and the timer above goes with it.
  // Coming back is the one that matters more: a phone woken from a pocket has
  // missed every tick since it went in, and "I finished it on the telly, then
  // picked up my phone" is the whole feature. Waiting up to five minutes for a
  // thawed timer is indistinguishable from it not working.
  document.addEventListener('visibilitychange', () => sync.run())

  // Leaving a film is the moment the library is most worth sending: it is the
  // one thing the other screen is waiting for, and the five-minute tick would
  // otherwise sit on it.
  useRouter().afterEach((_to, from) => {
    if (from.path === localePath('/watch'))
      sync.run()
  })
})
