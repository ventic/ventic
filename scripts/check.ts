// Every self-check in one run: `bun run check`.
//
// The list is read out of package.json rather than written here, because a list
// is the thing that goes stale: a `check:*` added tomorrow is in this run the
// day it is written, which is the same bargain `backup.ts` makes with a new
// preference. Nothing to keep in sync, and no way to add a check the release
// sweep then never runs.
//
// Each one is run to the end even after another has failed — the point before a
// release is to see everything that is wrong, not the first thing.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>
}

// `check:types` last: it is a whole-app vue-tsc pass and takes longer than all
// the others together, and the quick ones failing is the more common answer.
const names = Object.keys(pkg.scripts)
  .filter(name => name.startsWith('check:'))
  .sort((a, b) => Number(a === 'check:types') - Number(b === 'check:types'))

const failed: string[] = []

for (const name of names) {
  const label = name.slice('check:'.length)
  const started = Date.now()
  const run = spawnSync('bun', ['run', name], { encoding: 'utf8' })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  if (run.status === 0) {
    console.warn(`✓ ${label.padEnd(18)} ${seconds}s`)
    continue
  }

  failed.push(label)
  console.warn(`✗ ${label.padEnd(18)} ${seconds}s`)
  // Only the failures say anything more than their name: a passing check that
  // prints its output buries the one that didn't.
  console.warn(`${run.stdout ?? ''}${run.stderr ?? ''}`.trimEnd())
}

if (failed.length) {
  console.warn(`\n${failed.length} of ${names.length} failed: ${failed.join(', ')}`)
  process.exit(1)
}

console.warn(`\nall ${names.length} checks pass`)
