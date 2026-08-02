/**
 * When a drag from the left edge means "open the drawer".
 *
 * Vuetify's navigation drawer has swipe-to-open of its own, and on Android it
 * can never fire: its zone is the outer 25px, and the system's back gesture
 * takes everything up to about 27px — measured on a Pixel 8 Pro, where a touch
 * starting inside that band never reaches the webview at all. So the app opens
 * the drawer from a band just inside it, where the system has stopped looking.
 *
 * Kept apart from the plugin that wires it up so the numbers can be checked:
 * `bun run check:swipe`.
 */

/** Left edge of the band. Below this the OS takes the gesture. */
export const SWIPE_FROM = 30
/** Right edge of the band. Beyond this a drag is just a drag on the page. */
const SWIPE_TO = 100
/** How far right the finger has to travel before the drawer is meant. */
const SWIPE_OPEN = 60

/** Could a touch starting here be the start of a drawer swipe? */
export function inSwipeZone(x: number) {
  return x >= SWIPE_FROM && x <= SWIPE_TO
}

/**
 * Has this drag committed to opening the drawer? Vertical wins ties, so
 * scrolling a page that happens to start near the edge is never an open.
 */
export function opensDrawer(dx: number, dy: number) {
  return dx > SWIPE_OPEN && dx > Math.abs(dy)
}

// The band deliberately wins over anything under it that scrolls sideways,
// which on the home page is a poster row starting 16px from the same edge.
// Android's own DrawerLayout intercepts ahead of its children for exactly this
// reason, and checking first was worse: it made the gesture dead on the busiest
// screen in the app. What it costs is flicking a row *rightwards* from inside
// those 70px — and a row at that edge is usually already at its start, with
// nothing to the right to flick towards.
