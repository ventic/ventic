// Self-check for syncing a library between screens: `bun scripts/check-sync.ts`.
//
// The merge is the whole feature and none of it is visible until two devices
// disagree, which is exactly when nobody is in a position to debug it. What is
// held here: an entry written on one screen reaches the other, a deletion is not
// undone by the screen that hadn't heard about it, a switch turned off neither
// reads nor *wipes* the group it covers, and the three-way merge converges
// instead of two devices shoving a preference back and forth for ever.
//
// Plus the seams no compiler sees: the tombstone names `library.ts` writes have
// to be the localStorage key suffixes `mergeKeys` looks them up by, and the sync
// settings have to be in `backup.ts`'s SECRET set or a backup file carries the
// password to somebody's drive.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { makeBackup } from '../app/utils/backup'
import './i18n-stub'

const { GROUP_DEFAULTS, SYNC_GROUPS, baseOf, groupOf, mergeKeys, pruneDeleted, target, TOMBSTONE_LIFE } = await import('../app/utils/sync')

const NOW = 1_700_000_000_000
const MINUTE = 60_000

const ALL = { library: true, sources: true, preferences: true }

function keys(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [`ventic.${k}`, JSON.stringify(v)]))
}

function read(merged: Record<string, string>, name: string) {
  return JSON.parse(merged[`ventic.${name}`] ?? 'null')
}

// --- What is allowed to travel -----------------------------------------------

assert.equal(groupOf('ventic.progress'), 'library')
assert.equal(groupOf('ventic.favourites'), 'library')
assert.equal(groupOf('ventic.deleted'), 'library')
assert.equal(groupOf('ventic.sources'), 'sources')
// Anything unclassified is a preference, so a setting added tomorrow syncs the
// day it is written rather than the day someone remembers this table.
assert.equal(groupOf('ventic.subStyle'), 'preferences')
assert.equal(groupOf('ventic.somethingAddedLater'), 'preferences')

// These name *this* machine. A path off a laptop is not a path on a TV box.
for (const name of ['cached', 'local', 'downloadDir', 'ground', 'castName', 'sync'])
  assert.equal(groupOf(`ventic.${name}`), null, `ventic.${name} must never sync`)
// Not ours at all.
assert.equal(groupOf('vuetify:dynamic-theme-stylesheet'), null)

assert.equal(GROUP_DEFAULTS.library, true, 'watch history is what people asked for')
assert.equal(GROUP_DEFAULTS.preferences, false, 'a subtitle size that suits a laptop is wrong across a room')
assert.deepEqual(SYNC_GROUPS.map(g => g.key), ['library', 'sources', 'preferences'])
// The settings page renders these; a label built at module load can't call $t yet.
for (const group of SYNC_GROUPS)
  assert.ok(group.title() && group.hint(), `${group.key} needs a label`)

// --- Two devices, both used ---------------------------------------------------

{
  // The laptop watched a film; the television watched an episode. Neither may
  // lose the other's — the merge is per entry, not per map.
  const laptop = keys({
    progress: { 'movie:603': { position: 60, duration: 100, at: NOW - MINUTE, watched: false } },
    favourites: { 'movie:603': NOW - MINUTE },
  })
  const tv = keys({
    progress: { 'tv:1396:2:3': { position: 10, duration: 100, at: NOW - MINUTE, watched: false } },
    favourites: { 'tv:1396': NOW - MINUTE },
  })

  const merged = mergeKeys(laptop, tv, {}, ALL, NOW)
  assert.deepEqual(Object.keys(read(merged.local, 'progress')).sort(), ['movie:603', 'tv:1396:2:3'])
  assert.deepEqual(Object.keys(read(merged.local, 'favourites')).sort(), ['movie:603', 'tv:1396'])
  // What goes back up is what this device now holds.
  assert.deepEqual(merged.remote['ventic.progress'], merged.local['ventic.progress'])
}

{
  // The same film on both screens: the later position wins, whichever side it is.
  const older = keys({ progress: { 'movie:603': { position: 60, duration: 100, at: NOW - 10 * MINUTE, watched: false } } })
  const newer = keys({ progress: { 'movie:603': { position: 95, duration: 100, at: NOW - MINUTE, watched: true } } })

  assert.equal(read(mergeKeys(older, newer, {}, ALL, NOW).local, 'progress')['movie:603'].position, 95)
  assert.equal(read(mergeKeys(newer, older, {}, ALL, NOW).local, 'progress')['movie:603'].position, 95)
}

// --- Deletions ----------------------------------------------------------------

{
  // Unfavourited here, still there on the other screen. Without the tombstone the
  // merge reads the remote entry as something the *other* device added, hands it
  // back, and keeps handing it back for ever.
  const laptop = keys({ favourites: {}, deleted: { 'favourites:movie:603': NOW - MINUTE } })
  const tv = keys({ favourites: { 'movie:603': NOW - 10 * MINUTE } })

  const merged = mergeKeys(laptop, tv, {}, ALL, NOW)
  assert.deepEqual(read(merged.local, 'favourites'), {}, 'a deletion is not undone by the screen that had not heard about it')
  // And it travels, so the other screen drops it too rather than pushing it back.
  assert.ok(read(merged.remote, 'deleted')['favourites:movie:603'])

  // The other side, one sync later: the tombstone arrives in the file.
  const back = mergeKeys(tv, merged.remote, {}, ALL, NOW)
  assert.deepEqual(read(back.local, 'favourites'), {})
}

{
  // Favourited again after the deletion. A tombstone is not a ban.
  const laptop = keys({ favourites: { 'movie:603': NOW }, deleted: { 'favourites:movie:603': NOW - MINUTE } })
  const merged = mergeKeys(laptop, keys({ favourites: {} }), {}, ALL, NOW)
  assert.ok(read(merged.local, 'favourites')['movie:603'], 'a re-added entry outlives its own tombstone')
}

{
  // Watch state marked unwatched by hand, which deletes the row.
  const laptop = keys({ progress: {}, deleted: { 'progress:tv:1396:2:3': NOW - MINUTE } })
  const tv = keys({ progress: { 'tv:1396:2:3': { position: 10, duration: 100, at: NOW - 10 * MINUTE, watched: false } } })
  assert.deepEqual(read(mergeKeys(laptop, tv, {}, ALL, NOW).local, 'progress'), {})
}

assert.deepEqual(
  pruneDeleted({ old: NOW - TOMBSTONE_LIFE - 1, fresh: NOW - MINUTE }, NOW),
  { fresh: NOW - MINUTE },
  'a deletion every screen has long since heard about is not kept for ever',
)

// --- Snapshots ----------------------------------------------------------------

{
  // Posters and titles are a cache: added to, never individually removed, so a
  // union is the whole merge and no tombstone applies to one.
  const merged = mergeKeys(
    keys({ media: { 'movie:603': { title: 'The Matrix' } } }),
    keys({ media: { 'tv:1396': { title: 'Breaking Bad' } } }),
    {},
    ALL,
    NOW,
  )
  assert.deepEqual(Object.keys(read(merged.local, 'media')).sort(), ['movie:603', 'tv:1396'])
}

// --- Switches -----------------------------------------------------------------

{
  const laptop = keys({ progress: { 'movie:603': { position: 1, duration: 2, at: NOW, watched: false } }, subStyle: { size: 60 } })
  const tv = keys({ subStyle: { size: 30 } })
  const merged = mergeKeys(laptop, tv, {}, { ...ALL, preferences: false }, NOW)

  // Off means this device neither reads it...
  assert.equal(merged.local['ventic.subStyle'], undefined, 'a switched-off group is not applied locally')
  // ...nor writes it. A laptop with Preferences off must not wipe the
  // preferences two other screens are syncing to each other.
  assert.equal(read(merged.remote, 'subStyle').size, 30, 'a switched-off group is left in the file untouched')
  assert.ok(merged.remote['ventic.progress'], 'and the groups that are on still travel')
}

// --- One value, two screens ---------------------------------------------------

{
  const was = { 'ventic.theme': '"dark"' }

  // Only this screen changed it: it wins, and goes up.
  let merged = mergeKeys({ 'ventic.theme': '"forest"' }, { 'ventic.theme': '"dark"' }, was, ALL, NOW)
  assert.equal(merged.local['ventic.theme'], '"forest"')

  // Only the other screen changed it: take theirs.
  merged = mergeKeys({ 'ventic.theme': '"dark"' }, { 'ventic.theme': '"forest"' }, was, ALL, NOW)
  assert.equal(merged.local['ventic.theme'], '"forest"')

  // Both changed it. There is no timestamp on a single value, so this is a coin
  // toss — but it has to be the *same* toss on both screens or they push their
  // own version at each other for ever. The file wins, so the next merge on
  // either device is already agreed.
  merged = mergeKeys({ 'ventic.theme': '"forest"' }, { 'ventic.theme': '"ocean"' }, was, ALL, NOW)
  assert.equal(merged.local['ventic.theme'], '"ocean"')
  const settled = mergeKeys(merged.local, merged.remote, baseOf(merged.remote), ALL, NOW)
  assert.equal(settled.local['ventic.theme'], '"ocean"', 'and it stays settled')

  // Joining a folder another screen already fills: no base yet, so take what is there.
  merged = mergeKeys({ 'ventic.theme': '"dark"' }, { 'ventic.theme': '"ocean"' }, {}, ALL, NOW)
  assert.equal(merged.local['ventic.theme'], '"ocean"')

  // A key only this screen has — a build the other one hasn't been updated to.
  merged = mergeKeys({ 'ventic.uiScale': '1.2' }, {}, {}, ALL, NOW)
  assert.equal(merged.local['ventic.uiScale'], '1.2')
}

// The base is the single values only: the maps merge entry by entry and have no
// use for one, and keeping `media` in it would double what a library costs.
{
  const base = baseOf(keys({ theme: 'dark', progress: {}, media: {}, favourites: {}, deleted: {} }))
  assert.deepEqual(Object.keys(base), ['ventic.theme'])
}

// --- The file's address --------------------------------------------------------

assert.equal(target('https://dav.example.com/Ventic'), 'https://dav.example.com/Ventic/ventic-sync.json')
assert.equal(target('  https://dav.example.com/Ventic/  '), 'https://dav.example.com/Ventic/ventic-sync.json')
// Somebody who names the file themselves gets the file they named.
assert.equal(target('https://dav.example.com/shared/library.json'), 'https://dav.example.com/shared/library.json')

// --- Seams nothing else holds ---------------------------------------------------

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// `makeBackup` is what feeds the merge, so a key it drops can never sync — and
// the sync's own settings hold the password to somebody's drive.
assert.equal(
  makeBackup({ length: 1, key: () => 'ventic.sync', getItem: () => '{"pass":"hunter2"}', setItem: () => {} })
    .keys['ventic.sync'],
  undefined,
  'ventic.sync must be in backup.ts\'s SECRET set, or a backup file carries a password',
)

// The tombstone names the store writes have to be the localStorage key suffixes
// the merge looks them up by. Nothing connects the two but this, and getting one
// wrong is a deletion that silently never applies anywhere.
const store = source('app/stores/library.ts')
const tombstones = (name: string) => new RegExp(`forget\\(\`${name}:`).test(store)

assert.ok(tombstones('progress'), 'unmarking something watched must tombstone progress:<key>')
assert.ok(tombstones('liveFavourites'), 'unstarring a channel must tombstone liveFavourites:<key>')
// Favourites and the watchlist share one `toggle`, which is handed the list name.
assert.ok(/forget\(`\$\{list\}:\$\{key\}`\)/.test(store), 'both lists must tombstone through toggle()')
assert.ok(/type ListName = 'favourites' \| 'watchlist'/.test(store), 'and those are the two names it is handed')

// Forgetting the lot has to be tombstoned too, or an emptied library comes
// straight back from the screen that still holds one.
const clear = store.slice(store.indexOf('function clear()'))
assert.ok(/forget\(\.\.\.gone\)/.test(clear.slice(0, 900)), 'clear() must tombstone what it drops')
for (const name of ['progress', 'favourites', 'watchlist', 'liveFavourites'])
  assert.ok(clear.slice(0, 900).includes(`'${name}'`), `clear() must tombstone the ${name} map too`)

console.warn('sync: all checks pass')
