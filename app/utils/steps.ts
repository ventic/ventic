/**
 * What one press of a stepper does. A slider is a fine control for a mouse and
 * hopeless for a remote — a 0.02-step slider is forty presses to cross, and
 * up/down leave it changed — so every setting that was a slider is now a pair
 * of buttons, and this is the arithmetic behind them.
 *
 * Two kinds. A range walks `step` at a time between `min` and `max`; a list of
 * `values` walks the list, which is what a speed limit or a disk budget wants —
 * "Automatic, 1, 2, 5, 10, 20, 50" and not a hundred half-megabyte steps.
 *
 * Kept apart from the component so it can be checked: `bun run check:steps`.
 */
export type Steps = { min: number, max: number, step: number } | { values: number[] }

/** The value one press in `dir` lands on. The same value back means the end. */
export function stepTo(value: number, dir: 1 | -1, steps: Steps): number {
  if ('values' in steps) {
    // A value the list doesn't hold — one an older slider saved — starts from
    // the nearest stop, so the first press already lands on the list.
    const at = steps.values.reduce((best, v, i) =>
      Math.abs(v - value) < Math.abs(steps.values[best]! - value) ? i : best, 0)
    return steps.values[Math.max(0, Math.min(steps.values.length - 1, at + dir))]!
  }
  // Rounded to a thousandth: 0.2 + 0.1 is 0.30000000000000004 in floating
  // point, and that is what a tint of "30%" would otherwise be stored as.
  const next = Math.round((value + dir * steps.step) * 1000) / 1000
  return Math.min(steps.max, Math.max(steps.min, next))
}
