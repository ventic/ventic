/**
 * Swipe in from the left edge to open the navigation drawer — the gesture every
 * Android app with a drawer has.
 *
 * All three drawers (browse, transfers, settings) are the same `ui.drawer`
 * flag, so one listener here covers the app rather than three copies of it.
 * Closing needs nothing: Vuetify's own touch handling takes over once the
 * drawer is up, and the scrim closes it on a tap.
 *
 * Touch events only, so a mouse and a TV remote never see any of this. Why the
 * band starts where it does is in utils/swipe.ts.
 */
export default defineNuxtPlugin(() => {
  const ui = useUiStore()

  let x0 = 0
  let y0 = 0
  let live = false

  document.addEventListener('touchstart', e => {
    const t = e.changedTouches[0]
    if (!t)
      return
    x0 = t.clientX
    y0 = t.clientY
    live = !ui.drawer && inSwipeZone(x0)
  }, { passive: true })

  document.addEventListener('touchmove', e => {
    const t = e.changedTouches[0]
    if (!live || !t)
      return
    const dx = t.clientX - x0
    const dy = t.clientY - y0
    // Down the page rather than across it: hand the gesture back.
    if (Math.abs(dy) > Math.abs(dx)) {
      live = false
      return
    }
    if (opensDrawer(dx, dy)) {
      live = false
      ui.drawer = true
    }
  }, { passive: true })

  document.addEventListener('touchend', () => (live = false), { passive: true })
})
