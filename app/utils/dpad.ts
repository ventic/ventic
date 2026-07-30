export type Dir = 'up' | 'down' | 'left' | 'right'

/** The only parts of a DOMRect the picker reads, so it can be checked without a DOM. */
export interface Box { left: number, top: number, right: number, bottom: number }

function centre(box: Box, axis: 'x' | 'y') {
  return axis === 'x' ? (box.left + box.right) / 2 : (box.top + box.bottom) / 2
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

    const off = horizontal
      ? Math.abs(centre(box, 'y') - centre(from, 'y'))
      : Math.abs(centre(box, 'x') - centre(from, 'x'))

    // Sideways drift costs double, so a neighbour in line always beats a closer
    // one in the next column.
    const score = Math.max(gap, 0) + off * 2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })

  return best
}
