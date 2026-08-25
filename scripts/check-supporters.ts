// Self-check for the supporter list: `bun scripts/check-supporters.ts`.
//
// `supporters.json` is hand-edited on GitHub between releases and read live by
// every installed copy — so a half-finished entry in it reaches users before
// anything here is rebuilt. The parser's whole job is to drop what it can't read
// instead of taking the settings page down; this holds it to that, and checks
// the file in the repository is one the app can actually show.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { KOFI_URL, parseSupporters, SUPPORTERS_URL } from '../app/utils/supporters'

// --- The file we ship --------------------------------------------------------

const shipped = parseSupporters(JSON.parse(readFileSync('supporters.json', 'utf8')))
assert.ok(shipped.goal > 0, 'supporters.json needs a goal')
assert.ok(shipped.raised >= 0)
assert.equal(shipped.currency.length, 3)

// The URL has to name a branch, not a tag: the list is the live one.
assert.ok(SUPPORTERS_URL.includes('/main/supporters.json'), SUPPORTERS_URL)
assert.ok(SUPPORTERS_URL.startsWith('https://raw.githubusercontent.com/'), SUPPORTERS_URL)
assert.ok(KOFI_URL.startsWith('https://ko-fi.com/'), KOFI_URL)

// --- Nothing readable is thrown away -----------------------------------------

const parsed = parseSupporters({
  goal: '300', // JSON written by hand quotes numbers sooner or later
  raised: 42.5,
  currency: 'eur',
  monthly: [{ name: ' Ada ', at: '2026-08' }],
  once: [{ name: 'Bo', amount: '5' }],
})
assert.equal(parsed.goal, 300)
assert.equal(parsed.raised, 42.5)
assert.deepEqual(parsed.monthly, [{ name: 'Ada', amount: undefined, at: '2026-08' }])
assert.deepEqual(parsed.once, [{ name: 'Bo', amount: 5, at: undefined }])

// --- Nothing unreadable gets through -----------------------------------------

const junk = parseSupporters({
  goal: 'soon',
  currency: 'euros',
  monthly: [null, {}, { name: '   ' }, { name: 'Cy', amount: 'lots' }],
  once: 'nope',
})
assert.equal(junk.goal, 0) // the goal block hides rather than dividing by it
assert.equal(junk.currency, 'EUR') // Intl.NumberFormat throws on a bad code
assert.deepEqual(junk.monthly, [{ name: 'Cy', amount: undefined, at: undefined }])
assert.deepEqual(junk.once, [])

// An empty or absent file is the normal state on day one, not an error.
assert.deepEqual(parseSupporters(null).once, [])
assert.deepEqual(parseSupporters(undefined).monthly, [])

console.log('supporters: ok')
