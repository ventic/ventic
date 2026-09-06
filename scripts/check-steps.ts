// Self-check for the settings steppers: `bun scripts/check-steps.ts`.
//
// Every slider in Settings became a pair of buttons because a remote can't
// drive a slider (see utils/steps). Two things are held here: the arithmetic
// behind the buttons, and that no slider comes back to a page a television
// shows — the one left, the colour spectrum, hides itself there.
import assert from 'node:assert'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stepTo } from '../app/utils/steps'

// --- A range -----------------------------------------------------------------

const px = { min: 110, max: 300, step: 20 }
assert.strictEqual(stepTo(170, 1, px), 190, 'one press up is one step')
assert.strictEqual(stepTo(170, -1, px), 150, 'and one press down')
assert.strictEqual(stepTo(290, 1, px), 300, 'the last step is cut to the end, not skipped')
assert.strictEqual(stepTo(300, 1, px), 300, 'and the end stays put — that is what disables the button')
assert.strictEqual(stepTo(100, -1, px), 110, 'a value below the range climbs back onto it')

const tint = { min: 0.2, max: 1, step: 0.1 }
assert.strictEqual(stepTo(0.2, 1, tint), 0.3, 'floating point is rounded away, or 30% is stored as 0.30000000000000004')
assert.strictEqual(stepTo(1, 1, tint), 1, 'full is full')

// --- A list ------------------------------------------------------------------

const limits = [0, 1, 2, 5, 10, 20, 50]
assert.strictEqual(stepTo(5, 1, { values: limits }), 10, 'a list walks its own stops')
assert.strictEqual(stepTo(5, -1, { values: limits }), 2, 'in both directions')
assert.strictEqual(stepTo(0, -1, { values: limits }), 0, 'and stops at the first')
assert.strictEqual(stepTo(50, 1, { values: limits }), 50, 'and the last')
assert.strictEqual(stepTo(3.5, 1, { values: limits }), 5, 'a value the old slider saved starts from the nearest stop')
assert.strictEqual(stepTo(3.5, -1, { values: limits }), 1, 'either way')

// --- No slider a remote can reach --------------------------------------------

function* vues(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      yield* vues(path)
    else if (name.endsWith('.vue'))
      yield path
  }
}

const root = new URL('../app/pages/settings', import.meta.url).pathname
for (const path of vues(root)) {
  const src = readFileSync(path, 'utf8')
  const sliders = src.match(/<v-slider[\s\S]*?>/g) ?? []
  for (const slider of sliders) {
    assert.match(slider, /v-if="!tv"/, `${path}: a slider a television would show — use <settings-stepper>, or hide it with v-if="!tv"`)
  }
}

const bar = readFileSync(new URL('../app/components/OptionsBar.vue', import.meta.url), 'utf8')
assert.match(bar, /v-if="ui\.isGrid && !tv"/, 'the poster-size slider on the browse bar stays off a television')

console.info('steps: ok')
