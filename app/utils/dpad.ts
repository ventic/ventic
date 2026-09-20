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
