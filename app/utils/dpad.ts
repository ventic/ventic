export type Dir = 'up' | 'down' | 'left' | 'right'

/** The only parts of a DOMRect the picker reads, so it can be checked without a DOM. */
export interface Box { left: number, top: number, right: number, bottom: number }

/**
 * How far apart two boxes are on one axis, counting any overlap as level.
 *
 * Centres would be the obvious measure and are the wrong one: a 361px poster
 * and a 44px nav link sitting side by side are 160px apart by centre even when
 * the link is squarely inside the poster's span, which is enough to lose to a
 * short dropdown well above both. What "off to the side" should mean is that
 * the boxes don't face each other at all.
 */
function apart(a: Box, b: Box, axis: 'x' | 'y') {
  const [aMin, aMax] = axis === 'x' ? [a.left, a.right] : [a.top, a.bottom]
  const [bMin, bMax] = axis === 'x' ? [b.left, b.right] : [b.top, b.bottom]
  return Math.max(0, Math.max(aMin, bMin) - Math.min(aMax, bMax))
}

/**
 * Which box a d-pad press should land on: the nearest one that way, with
 * anything off to the side penalised so a grid walks straight down its column
 * instead of drifting diagonally. Returns -1 when nothing lies in that
 * direction.
 */
export function pickDirection(from: Box, boxes: Box[], dir: Dir): number {
  const horizontal = dir === 'left' || dir === 'right'
  let best = -1
  let bestScore = Number.POSITIVE_INFINITY
  /** Whether the leader is one of the boxes squarely in this row or column. */
  let bestInLine = false

  boxes.forEach((box, i) => {
    // Distance between the two edges facing each other. A pixel of overlap is
    // normal between neighbours; more than that and it isn't "that way" at all.
    const gap = dir === 'right'
      ? box.left - from.right
      : dir === 'left'
        ? from.left - box.right
        : dir === 'down'
          ? box.top - from.bottom
          : from.top - box.bottom

    if (gap < -2)
      return

    const off = apart(from, box, horizontal ? 'y' : 'x')

    // Facing us at all — the boxes overlap on the other axis — is what "on this
    // row" means, and one of those wins over anything that isn't however much
    // closer it is. Weighting drift alone wasn't enough: walking right along the
    // toolbar, Downloads is 264px past the search box while the poster grid
    // starts 74px below it, so a straight run across the top of the screen fell
    // into the posters and Downloads and Settings could only be reached the long
    // way round. Among boxes of the same standing the distance decides, drift
    // still costing double so a grid walks straight down its column.
    const inLine = off === 0
    const score = Math.max(gap, 0) + off * 2
    if (inLine === bestInLine ? score < bestScore : inLine) {
      bestInLine = inLine
      bestScore = score
      best = i
    }
  })

  return best
}

/**
 * A box as it can actually be seen: each edge pulled inside every scroller the
 * element sits in, so something scrolled out of its own grid collapses onto the
 * edge it went past instead of reporting where it would have been.
 *
 * A rect is the whole document's, not the visible part's, and the picker had no
 * idea: a poster three rows above the fold still measured level with the
 * toolbar, so "right" off the search box landed on it rather than on Settings,
 * and "up" out of the drawer landed on one 350px above the screen — after which
 * every further press was measured from somewhere nobody could see.
 *
 * Collapsing rather than dropping is the whole trick. A horizontal row's next
 * card is off the right edge by design and pressing right has to reach it; sat
 * on the edge it came from, it is still the nearest thing that way and still
 * wins — while something clean off the top is no longer level with anything.
 */
export function clipped(box: Box, clips: Box[]): Box {
  // Destructured, never spread: what arrives here is a real DOMRect, whose
  // edges are getters on the prototype, so `{ ...box }` is `{}` and every edge
  // comes back NaN — which the picker reads as nothing in any direction, and
  // the whole page stops answering the arrow keys.
  let { left, top, right, bottom } = box
  for (const c of clips) {
    left = Math.min(Math.max(left, c.left), c.right)
    right = Math.max(Math.min(right, c.right), c.left)
    top = Math.min(Math.max(top, c.top), c.bottom)
    bottom = Math.max(Math.min(bottom, c.bottom), c.top)
  }
  return { left, top, right, bottom }
}

// -----------------------------------------------------------------------------
// The scrolling half. Everything below is arithmetic the plugin used to keep
// inside its own closure, where `check:dpad` could only assert that the code
// looked right — it could not run it. Each of these is a bug that reached the
// television, so each of them is tested now.
// -----------------------------------------------------------------------------

/** A scroll position: what `scrollTop`/`scrollLeft` are, and what a glide aims at. */
export interface Offset { top: number, left: number }

/**
 * Where a scroller can actually stop, given how far it has to give in each
 * axis.
 *
 * Clamping is the whole point and it is not a tidying-up: a destination the
 * scroller can never reach is one `resting` goes on answering with for ever,
 * and every later press is then measured against a page that does not exist.
 * One nudge to the foot of a title page left everything judged against a page
 * 517px further down, and "down" off the last row of More like this jumped into
 * the sidebar.
 */
export function within(to: Offset, maxTop: number, maxLeft: number): Offset {
  return {
    top: Math.max(0, Math.min(to.top, Math.max(0, maxTop))),
    left: Math.max(0, Math.min(to.left, Math.max(0, maxLeft))),
  }
}

/**
 * One frame of the ease toward `goal`, `ms` after the frame that put us `at`.
 *
 * Exponential rather than a fixed curve, because the platform's own smooth
 * scroll cannot be retargeted: a `scrollTo` mid-animation *cancels* what is
 * running and eases in from a standstill, so a press landing mid-scroll stopped
 * the page dead and started again. Measured on the set, eight presses 120ms
 * apart — the page crawled at 5px a frame for three seconds and then covered
 * 2000px in half of one, once the presses stopped. A target this is already
 * chasing costs nothing to move: there is no curve to restart, and the speed
 * already there carries into it.
 *
 * `EASE` is the time constant in ms — about 95% of the way there in a fifth of
 * a second. `ms` is capped by the caller so a dropped second's worth of frames
 * eases rather than teleports.
 */
export const EASE = 70

export function eased(at: Offset, goal: Offset, ms: number): Offset {
  const k = 1 - Math.exp(-ms / EASE)
  return {
    top: at.top + (goal.top - at.top) * k,
    left: at.left + (goal.left - at.left) * k,
  }
}

/** Close enough to stop easing and sit exactly on it. Sub-pixel, so it is invisible. */
export function arrived(at: Offset, goal: Offset) {
  return Math.abs(goal.top - at.top) < 0.5 && Math.abs(goal.left - at.left) < 0.5
}

/**
 * How far a span has to move to sit between `near` and `far` — `nearest`:
 * nothing if it already does, and never further than lining its leading edge
 * up, which is what stops something taller than the viewport jumping past.
 *
 * Worked out here rather than asked of `scrollIntoView`, which computes the
 * same thing from wherever the page has got to and cannot be made to ask about
 * the page at rest — so mid-animation it asked for the whole remaining distance
 * plus* a row, and each press of a burst aimed further than the last.
 */
export function nearest(from: number, to: number, near: number, far: number) {
  if (from < near)
    return from - near
  if (to > far)
    return Math.min(to - far, from - near)
  return 0
}

/** The same box, moved. */
export function shift(box: Box, dx: number, dy: number): Box {
  return { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy }
}
