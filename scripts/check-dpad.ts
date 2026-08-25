import type { Box } from '../app/utils/dpad'
// Self-check for the d-pad picker: `bun scripts/check-dpad.ts`.
// The boxes below are the three layouts a remote actually walks: a poster grid,
// a horizontal row, and the player's control bar. After them comes the other
// half of the remote — BACK, which is Kotlin's to catch and the page's to answer.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
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

// Out of the sidebar and into the posters, which is the move the drawer exists
// for. The filter bar above the grid is a short box and a poster is a tall one,
// so by centre distance the dropdown won every time and the grid was
// unreachable from the nav — measured on the TV at 960x540.
const navMovies = box(8, 124, 220, 44)
const sortMenu = box(260, 81, 168, 24)
const poster = box(260, 130, 211, 361)
assert.strictEqual(pickDirection(navMovies, [sortMenu, poster], 'right'), 1, 'right off the nav reaches the poster, not the filter bar')

// And back: the item level with the card, rather than whatever the list calls
// first. Ties go to the earliest in document order, which reads top-down.
const navLinks = [box(8, 76, 220, 44), navMovies, box(8, 172, 220, 44)]
assert.strictEqual(pickDirection(poster, navLinks, 'left'), 1, 'left off a poster reaches the nav item beside it')

// Off the end of the category chips and onto the genre filter beside them. The
// chips are a slide group, which walks left/right itself and wraps, so the
// plugin has to take the key back at the last one (see `trapped`) — and once it
// has, the filter must beat the poster row starting just below and the poster-
// size slider further along the bar. Boxes measured on the TV at 1280x720.
const chip = box(565, 80, 78, 26)
const genre = box(660, 89, 168, 24)
const sizeSlider = box(1066, 86, 14, 14)
const firstPoster = box(661, 130, 184, 321)
assert.strictEqual(pickDirection(chip, [genre, sizeSlider, firstPoster], 'right'), 0, 'right off the last chip reaches the genre filter')

// Straight along the toolbar. Downloads is a long way past the search box and
// the poster grid is only just below it, so by weighted distance alone a run
// across the top of the screen dropped into the posters — and Downloads,
// Settings and Account were unreachable except by climbing the far right of the
// grid. Boxes measured on the TV.
const searchBox = box(404, 16, 432, 40)
const downloads = box(1100, 12, 48, 48)
const posterRight = box(861, 130, 184, 321)
assert.strictEqual(pickDirection(searchBox, [posterRight, downloads], 'right'), 1, 'right along the toolbar stays on the toolbar')
assert.strictEqual(pickDirection(downloads, [posterRight, searchBox], 'left'), 1, 'and back again')
// But only while something is genuinely level: with the toolbar exhausted, down
// into the page is exactly what should happen.
assert.strictEqual(pickDirection(searchBox, [posterRight], 'right'), 0, 'nothing level means the nearest anywhere')

// The seek rail spans the window and the buttons sit under it, so every button
// overlaps it: the one directly above must not become "every direction".
assert.strictEqual(pickDirection(seek, bar, 'down'), 0, 'down off the rail takes the first button')

// A box that *encloses* the targets has none of them in any direction, which is
// correct and is also a dead end: Vuetify parks focus on a dialog's content
// wrapper when it opens, and from there no arrow reached Cancel or Delete files
// — measured on the TV, focus never left the wrapper. The plugin has to notice
// it is on a container and hand over to focusFirst; nothing here can rescue it.
const dialog = box(410, 266, 460, 188)
const actions = [box(426, 396, 84, 34), box(614, 396, 106, 34), box(730, 396, 124, 34)]
for (const dir of ['up', 'down', 'left', 'right'] as const)
  assert.strictEqual(pickDirection(dialog, actions, dir), -1, `a wrapper has nothing ${dir} of it`)
assert.strictEqual(pickDirection(actions[0]!, actions.slice(1), 'right'), 0, 'while its buttons walk normally')

/* --- BACK, which is a contract between two languages ---------------------- */

/**
 * Kotlin with its comments taken out.
 *
 * Every rule below is about what the file *does*, and the comments explaining
 * why it does it name the very things being ruled out — the note above `leave()`
 * says "deliberately not `finish()`", which is exactly the string that must not
 * appear in the code. There are no `//` sequences inside string literals here,
 * so nothing subtler than this is needed.
 */
function code(kotlin: string) {
  return kotlin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const activity = code(readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/java/com/ventic/app/MainActivity.kt', import.meta.url),
  'utf8',
))
const manifest = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)
const plugin = readFileSync(new URL('../app/plugins/dpad.client.ts', import.meta.url), 'utf8')

// The name Kotlin evaluates is a string on one side and an assignment on the
// other, so nothing but this notices when one of them is renamed. A miss is
// silent and total: `window.__tvBack` comes back undefined, which reads as "the
// page didn't handle it", and BACK leaves the app from every screen there is.
for (const hook of ['__tvBack', '__tvOk']) {
  assert.ok(activity.includes(`window.${hook}`), `MainActivity calls ${hook}`)
  assert.ok(plugin.includes(`window.${hook} =`), `and dpad.client.ts still defines it`)
}

// BACK arrives by two different mechanisms and the app must not care which:
// below API 33 as a KeyEvent, and from API 33 (declared) or 35 (whether declared
// or not) through OnBackInvokedDispatcher, where `onKeyDown` is never called at
// all. Both feed OnBackPressedDispatcher, so that is the only place to answer
// it — catching the keycode instead is what left Android 15 phones closing the
// app out of dialogs and out of the middle of a film.
assert.ok(
  activity.includes('OnBackPressedCallback') && activity.includes('onBackPressedDispatcher.addCallback'),
  'BACK is answered on the dispatcher both mechanisms feed',
)
assert.ok(
  !/override fun onKeyDown/.test(activity),
  'and not on onKeyDown, which predictive back never calls',
)
assert.match(
  manifest,
  /android:enableOnBackInvokedCallback="true"/,
  'declared, so API 33 and 34 take the same path as 35 rather than the other one',
)

// Answering on the dispatcher is not enough on its own: wry adds a callback of
// its own to the same dispatcher unless this is off, and it wins — it is
// registered when the webview is created, ours in onCreate, and the dispatcher
// runs the last one added. All wry's does is `webView.goBack()`, so BACK popped
// a history entry rather than closing whatever was open in front of it, and
// `__tvBack` was only ever reached at the root, where `canGoBack()` is false.
assert.match(
  activity,
  /override val handleBackNavigation: Boolean = false/,
  'and wry\'s own goBack() callback is off, or it takes the key before ours',
)

// And that is still not enough, because the WebView answers BACK on its own
// account: it pops its history whenever `canGoBack()` is true, and it sits below
// the activity in the view hierarchy, so `super.dispatchKeyEvent` spends the key
// there before `onBackPressedDispatcher` is ever consulted. Measured on the box:
// BACK on a film with the subtitle panel open left the film and never closed the
// panel, and only at the root — no history to pop — did `__tvBack` run at all.
// Predictive back skips `dispatchKeyEvent` entirely, so this is the older path
// being routed to the same callback, not a second rule.
assert.match(
  activity,
  /KeyEvent\.KEYCODE_BACK[\s\S]*?onBackPressedDispatcher\.onBackPressed\(\)[\s\S]*?return true/,
  'and BACK is taken before super.dispatchKeyEvent, or the WebView pops history with it',
)

// Back at the root must not finish the activity. Finishing leaves the process
// alive, wry runs the Rust side once per process and never again, and the next
// launch attaches a new activity to an event loop whose webview is already gone
// — which aborts. Backgrounding the task has none of that and is what every
// other Android app does with back at the root.
assert.ok(activity.includes('moveTaskToBack(true)'), 'back at the root backgrounds the task')
assert.ok(!/\bfinish\(\)/.test(activity), 'and never finishes the activity')

// The other end of the same rule: an activity that really is going must take the
// process with it, so that the next launch is the cold start `run()` is written
// for. Anything less leaves port 3030 held by a librqbit session nobody can
// reach.
assert.match(
  activity,
  /if \(isFinishing[^)]*\) \{\s*Process\.killProcess\(Process\.myPid\(\)\)/,
  'a finishing activity takes the process with it',
)

console.info('d-pad picker: ok')
