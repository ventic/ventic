// Self-check for the drawer's edge swipe: `bun scripts/check-swipe.ts`.
//
// The numbers here are measured, not chosen: on a Pixel 8 Pro a touch starting
// at CSS x≤27 is swallowed by Android's back gesture and never reaches the
// webview at all, which is why the band cannot simply start at 0 — and why
// Vuetify's own 0-25px zone is dead on that platform.
import assert from 'node:assert'
import { inSwipeZone, opensDrawer, SWIPE_FROM } from '../app/utils/swipe'

// --- The band ---------------------------------------------------------------

assert.ok(SWIPE_FROM > 27, 'the band has to start clear of Android\'s back gesture')

assert.ok(!inSwipeZone(0), 'the very edge belongs to the OS')
assert.ok(!inSwipeZone(27), 'so does the rest of the system gesture band')
assert.ok(inSwipeZone(40), 'just inside is ours')
assert.ok(inSwipeZone(95), 'and so is the far side of the band')
assert.ok(!inSwipeZone(200), 'a drag from the middle of the page is not a drawer swipe')

// --- The drag ---------------------------------------------------------------

assert.ok(opensDrawer(90, 4), 'a flat drag to the right opens it')
assert.ok(!opensDrawer(20, 2), 'a twitch does not')
assert.ok(!opensDrawer(-90, 4), 'nor does a drag the other way')

// Scrolling the page starts at some x too, and often drifts sideways doing it.
assert.ok(!opensDrawer(90, 140), 'mostly-vertical is a scroll, not an open')
assert.ok(!opensDrawer(70, 70), 'a 45° drag is ambiguous, so it is a scroll')

console.info('drawer swipe: ok')
