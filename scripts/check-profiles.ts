// Self-check for profiles and parental controls: `bun scripts/check-profiles.ts`.
//
// Most of what is held here fails quietly when it breaks: a child's profile that
// plays an R film, a grown-up's that opens without the PIN, a library that turns
// up under the wrong person, a limit that never runs out. So the rules first —
// what a rating allows, when the PIN is asked for, how a day's watching is
// counted — and then the seams between files that nothing else connects.
import type { Profile } from '../app/utils/profiles'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import './i18n-stub'

const {
  addTime,
  allowed,
  checkPin,
  DEFAULT_PROFILE,
  discoverParams,
  hashPin,
  levelOf,
  listProfiles,
  mapLimit,
  needsPin,
  NSFW_KEYWORDS,
  scoped,
  secondsLeft,
  spendTime,
  unscope,
} = await import('../app/utils/profiles')

// --- Keys ---------------------------------------------------------------------

// The default profile is the library every install already has, under the keys
// it always had — that is the whole migration.
assert.equal(scoped('ventic.progress', DEFAULT_PROFILE), 'ventic.progress')
assert.equal(scoped('ventic.progress', 'k1'), 'ventic.progress@k1')
assert.deepEqual(unscope('ventic.progress@k1'), ['ventic.progress', 'k1'])
assert.deepEqual(unscope('ventic.progress'), ['ventic.progress', DEFAULT_PROFILE])
// With no storage to read (this script), the page is the default profile's.
assert.equal(scoped('ventic.theme'), 'ventic.theme')

// --- Who is on the install ------------------------------------------------------

const grownUp: Profile = { id: DEFAULT_PROFILE, name: '', colour: '#000', at: 0 }
const kid: Profile = { id: 'k1', name: 'Ana', colour: '#000', at: 1, kids: { level: 'little', minutes: 60 } }
const teen: Profile = { id: 't1', name: 'Bor', colour: '#000', at: 1, kids: { level: 'teens', minutes: 0 } }
const partner: Profile = { id: 'p1', name: 'Cene', colour: '#000', at: 1 }

{
  // The default is there before anyone has edited it, and always first.
  const list = listProfiles({ t1: teen, k1: kid, gone: { id: 'gone', name: 'Zed', colour: '', at: 2, gone: true } })
  assert.deepEqual(list.map(p => p.id), [DEFAULT_PROFILE, 'k1', 't1'], 'the default first, then by name, the deleted left out')
}

// --- What a rating allows -------------------------------------------------------

assert.ok(allowed('movie', 'R', undefined), 'no parental controls, no ceiling')
assert.ok(allowed('movie', '', undefined), 'not even for an unrated film')

assert.ok(allowed('movie', 'G', kid.kids))
assert.ok(!allowed('movie', 'PG', kid.kids), 'little kids stop at G')
assert.ok(allowed('tv', 'TV-Y7', kid.kids), 'TMDB orders TV-Y7 below TV-G, so the little band takes it')
assert.ok(!allowed('tv', 'TV-PG', kid.kids))
assert.ok(allowed('movie', 'PG-13', teen.kids))
assert.ok(!allowed('movie', 'R', teen.kids))
assert.ok(allowed('tv', 'TV-14', teen.kids))
assert.ok(!allowed('tv', 'TV-MA', teen.kids))
// Nobody rated it, so nobody vouched for it.
assert.ok(!allowed('movie', '', teen.kids), 'unrated is not allowed')
assert.ok(!allowed('tv', 'NR', teen.kids), 'and neither is "not rated"')
// A level this build doesn't know (a newer one synced it) is the strictest, never none.
assert.equal(levelOf({ level: 'toddlers' as never, minutes: 0 }).movie, 'G')

// --- What a browse page asks TMDB for --------------------------------------------

assert.deepEqual(discoverParams('movie', grownUp), {}, 'a grown-up\'s Movies page is the page it always was')
assert.deepEqual(discoverParams('tv', grownUp), { without_keywords: NSFW_KEYWORDS }, 'NSFW anime is hidden by default')
assert.deepEqual(discoverParams('tv', { nsfw: true }), {}, 'and shown to whoever asked for it')
assert.deepEqual(discoverParams('movie', kid), {
  'certification_country': 'US',
  // From the mildest rating, not just up to theirs: TMDB files "NR" below G,
  // so a ceiling alone lets every unrated film through.
  'certification.gte': 'G',
  'certification.lte': 'G',
})
assert.deepEqual(discoverParams('tv', { ...teen, nsfw: true }), {
  'certification_country': 'US',
  'certification.gte': 'TV-Y',
  'certification.lte': 'TV-14',
  'without_keywords': NSFW_KEYWORDS,
}, 'a child never gets the NSFW anime, whatever the flag says')
// Hentai, erotic, softcore, erotica, animated porn — and not ecchi, which is on Fairy Tail.
assert.equal(NSFW_KEYWORDS, '198385|256466|155477|325693|378816')

// --- When the PIN is asked for ----------------------------------------------------

{
  const house = [grownUp, kid, teen, partner]
  const adults = [grownUp, partner]

  assert.ok(!needsPin(partner, grownUp, adults, false), 'no child on the install, nothing to guard')
  assert.ok(!needsPin(partner, grownUp, adults, true))

  // At a cold start nobody is in any profile yet — even the one open last asks.
  assert.ok(needsPin(grownUp, grownUp, house, false), 'a grown-up\'s profile takes the PIN at the gate')
  assert.ok(needsPin(partner, grownUp, house, false))
  assert.ok(!needsPin(kid, grownUp, house, false), 'a child picks their own freely')

  // Switching from a grown-up's profile mid-session.
  assert.ok(!needsPin(grownUp, grownUp, house, true), 'staying put is not switching')
  assert.ok(!needsPin(kid, grownUp, house, true), 'handing the remote to a child needs nothing')
  assert.ok(needsPin(partner, grownUp, house, true), 'another grown-up\'s profile is still locked')

  // A child's profile is left only with the PIN — into a sibling's too, or the
  // one whose time is up just becomes the one whose time isn't.
  assert.ok(needsPin(grownUp, kid, house, true))
  assert.ok(needsPin(teen, kid, house, true), 'not even to a sibling')
  assert.ok(!needsPin(kid, kid, house, true))
}

// --- Today's watching -------------------------------------------------------------

{
  const day = new Date(2026, 9, 4, 18).getTime()
  const later = day + 3 * 3600_000
  const tomorrow = new Date(2026, 9, 5, 8).getTime()
  const none = { day: '', seconds: 0, extra: 0 }

  assert.equal(secondsLeft(none, 0, day), Infinity, 'no limit, nothing runs out')
  assert.equal(secondsLeft(none, 60, day), 3600)

  let usage = spendTime(none, 3000, day)
  assert.equal(secondsLeft(usage, 60, later), 600, 'the same day carries on counting')
  usage = spendTime(usage, 600, later)
  assert.equal(secondsLeft(usage, 60, later), 0, 'and runs out')
  usage = addTime(usage, 30 * 60, later)
  assert.equal(secondsLeft(usage, 60, later), 1800, 'a grown-up adds half an hour')
  assert.equal(secondsLeft(usage, 60, tomorrow), 3600, 'midnight starts a fresh day, extra time included')
  assert.equal(spendTime(usage, 10, tomorrow).seconds, 10)
  assert.equal(addTime(usage, 60, tomorrow).extra, 60, 'and time added tomorrow is tomorrow\'s')
}

// --- The PIN itself ----------------------------------------------------------------

{
  const stored = await hashPin('1234')
  assert.ok(await checkPin('1234', stored))
  assert.ok(!(await checkPin('4321', stored)))
  assert.ok(!stored.includes('1234'), 'the PIN is not in what is stored')
  assert.notEqual(await hashPin('1234'), stored, 'salted: the same PIN never stores the same twice')
  assert.ok(!(await checkPin('1234', '')), 'no PIN chosen is not a PIN that matches')
}

// --- A list checked a title at a time ------------------------------------------------

{
  let running = 0
  let most = 0
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async n => {
    most = Math.max(most, ++running)
    await new Promise(resolve => setTimeout(resolve, 5 - (n % 3)))
    running--
    return n * 2
  })
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20], 'answers in the order asked')
  assert.ok(most <= 3, 'and no more than the limit at once')
  assert.deepEqual(await mapLimit([], 8, async x => x), [])
}

// --- Seams nothing else holds ---------------------------------------------------------

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Every map of a library has to be the profile's, or two people share a history.
const library = source('app/stores/library.ts')
for (const name of ['media', 'progress', 'favourites', 'watchlist', 'liveFavourites', 'deleted'])
  assert.ok(library.includes(`scoped('ventic.${name}')`), `ventic.${name} must go through scoped()`)

// And the machine's settings have to stay the machine's: a child's profile with
// its own source list, or its own download folder, is a way round both.
const settings = source('app/stores/settings.ts')
for (const name of ['sources', 'playlists', 'downloadDir', 'castReceive', 'castCode'])
  assert.ok(settings.includes(`useLocalStorage<string[]>('ventic.${name}'`) || settings.includes(`useLocalStorage('ventic.${name}'`), `ventic.${name} must stay shared`)

// The gate is the middleware, and every place a child's profile is kept out of
// goes through it — a cast and a deep link included.
const gate = source('app/middleware/profile.global.ts')
for (const route of ['/profiles', '/downloads', '/live', '/watch'])
  assert.ok(gate.includes(`'${route}'`), `the profile middleware must handle ${route}`)
assert.ok(/inSettings\(to\.path\) && !\(await profiles\.askPin/.test(gate), 'settings on a child\'s profile must take the PIN')
assert.ok(/!profiles\.chosen \|\| profiles\.timeUp/.test(gate), 'the gate must hold until someone is chosen, and once time is up')

// The pad everything waits on is mounted once, outside every layout — the
// picker and the player have none.
assert.ok(/<pin-dialog \/>/.test(source('app/app.vue')), 'PinDialog must be mounted in app.vue')

// Watch time is spent by the player, and the player leaves when it runs out.
const player = source('app/components/MpvPlayer.vue')
assert.ok(/profiles\.spend\(TICK\)/.test(player) && /profiles\.timeUp\)[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*emit\('exit'\)/.test(player), 'MpvPlayer must spend watch time and leave when it is up')

// A child's browse lists are narrowed by TMDB where it can, and a title at a time where it can't.
assert.ok(/\.\.\.profiles\.discover\(props\.type\)/.test(source('app/components/MediaBrowser.vue')), 'the browse pages must send the profile\'s discover params')
assert.ok(/profiles\.allowedOnly\(fresh\)/.test(source('app/composables/useMediaFeed.ts')), 'every other feed must be checked a title at a time')

console.warn('profiles: all checks pass')
