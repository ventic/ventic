import type { Box } from '../app/utils/dpad'
// Self-check for the d-pad picker: `bun scripts/check-dpad.ts`.
// The boxes below are the three layouts a remote actually walks: a poster grid,
// a horizontal row, and the player's control bar.
import assert from 'node:assert'
import { pickDirection } from '../app/utils/dpad'

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height }
}

// A 4-column grid of 170x255 posters, 16px apart, two rows.
const grid = [
  box(0, 0, 170, 255),
  box(186, 0, 170, 255),
  box(372, 0, 170, 255),
  box(558, 0, 170, 255),
  box(0, 275, 170, 255),
  box(186, 275, 170, 255),
  box(372, 275, 170, 255),
  box(558, 275, 170, 255),
]

const from = grid[1]!
const rest = grid.filter(b => b !== from)
const at = (b: Box) => rest.indexOf(b)

assert.strictEqual(pickDirection(from, rest, 'right'), at(grid[2]!), 'right goes to the next card')
assert.strictEqual(pickDirection(from, rest, 'left'), at(grid[0]!), 'left goes back one card')
assert.strictEqual(pickDirection(from, rest, 'down'), at(grid[5]!), 'down stays in the same column')
assert.strictEqual(pickDirection(from, rest, 'up'), -1, 'nothing above the top row')

// Same, from the bottom row: up must not drift a column sideways.
const below = grid[6]!
const others = grid.filter(b => b !== below)
assert.strictEqual(pickDirection(below, others, 'up'), others.indexOf(grid[2]!), 'up stays in the same column')

// A control bar: buttons of different widths on one line, plus the seek rail
// above them. Left/right must stay on the line rather than jumping to the rail.
const seek = box(20, 60, 1240, 16)
const bar = [box(20, 88, 38, 38), box(62, 88, 38, 38), box(104, 88, 38, 38), box(1180, 88, 80, 38)]
const controls = [seek, ...bar]

const play = bar[0]!
const fromPlay = controls.filter(b => b !== play)
assert.strictEqual(pickDirection(play, fromPlay, 'right'), fromPlay.indexOf(bar[1]!), 'right walks the bar')
assert.strictEqual(pickDirection(play, fromPlay, 'up'), fromPlay.indexOf(seek), 'up reaches the seek rail')
assert.strictEqual(pickDirection(play, fromPlay, 'down'), -1, 'nothing below the bar')

// The far-right button is a long way off but still the only thing that way.
assert.strictEqual(pickDirection(bar[2]!, controls.filter(b => b !== bar[2]), 'right'), 3, 'a gap is still a target')

// A sidebar to the left of the grid: left off the first column leaves the grid.
const link = box(-236, 120, 220, 44)
assert.strictEqual(pickDirection(grid[0]!, [link, ...grid.slice(1)], 'left'), 0, 'left off the grid reaches the nav')
assert.strictEqual(pickDirection(grid[1]!, [link, ...grid.filter(b => b !== grid[1])], 'left'), 1, 'the nearer card wins over the nav')

console.info('d-pad picker: ok')
