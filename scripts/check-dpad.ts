import type { Box } from '../app/utils/dpad'
// Self-check for the d-pad picker: `bun scripts/check-dpad.ts`.
// The boxes below are the three layouts a remote actually walks: a poster grid,
// a horizontal row, and the player's control bar. After them comes the other
// half of the remote — BACK, which is Kotlin's to catch and the page's to answer.
import assert from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { arrived, clipped, eased, nearest, pickDirection, shift, within } from '../app/utils/dpad'

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

/* --- what can actually be seen -------------------------------------------- */

// A rect is the whole document's. The page scrolls inside a region below the
// toolbar, so a poster three rows above the fold still reports a box level with
// the search field — and "right" off the search box landed on that poster
// instead of on Downloads, after which every further press was measured from
// somewhere nobody could see. Boxes measured on the TV at 1280x720.
const view = box(0, 0, 1280, 720)
const region = box(236, 66, 1044, 654)
const goneUp = box(1000, -260, 184, 321)
assert.deepStrictEqual(
  clipped(goneUp, [region, view]),
  { left: 1000, top: 66, right: 1184, bottom: 66 },
  'a card scrolled above its grid collapses onto the grid\'s top edge',
)
assert.strictEqual(
  pickDirection(searchBox, [clipped(goneUp, [region, view]), downloads], 'right'),
  1,
  'so right off the search box reaches Downloads, not a poster above the fold',
)

// Collapsing and not dropping, because a horizontal row's next card is off the
// right edge by design: sat on the edge it went past, it is still the nearest
// thing that way and still wins.
const row = box(236, 200, 1044, 321)
const onRow = box(1100, 200, 184, 321)
const nextAlong = box(1300, 200, 184, 321)
assert.strictEqual(
  pickDirection(clipped(onRow, [row, view]), [clipped(nextAlong, [row, view])], 'right'),
  0,
  'the next card along a row is still reachable once clipped to the row',
)

// What actually arrives here is a DOMRect, whose edges are getters on the
// prototype rather than own properties — so a `{ ...box }` copy is empty, every
// edge comes back NaN, and the picker reads that as nothing in any direction.
// Measured on the TV as a page that answered no arrow key at all.
const live: Box = Object.create({ left: 300, top: 200, right: 484, bottom: 521 })
assert.deepStrictEqual(
  clipped(live, [row, view]),
  { left: 300, top: 200, right: 484, bottom: 521 },
  'a box whose edges live on its prototype survives clipping',
)

// Nothing to clip against leaves a box alone, and a box already inside stays put.
assert.deepStrictEqual(clipped(onRow, []), onRow, 'no clips, no change')
assert.deepStrictEqual(clipped(box(300, 200, 184, 321), [row, view]), box(300, 200, 184, 321), 'a visible box is unchanged')

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

// The scroll is animated, and both halves of that are the plugin's own.
//
// The destination is worked out from the page **at rest**: `scrollIntoView`
// computes `nearest` from wherever the animation has got to — the whole
// remaining distance *plus* a row — so every press of a burst aimed further
// than the last and the page slid on for a second after the final one.
assert.ok(
  !/\.scrollIntoView\(/.test(plugin),
  'the destination is worked out here, not asked of a page mid-animation',
)

// And the movement is a frame loop easing toward that target, because the
// platform's cannot be retargeted: a `scrollTo` with a smooth behaviour cancels
// whatever is running and eases in from a standstill, so a press landing
// mid-scroll stopped the page dead and started again. Measured on the set,
// eight presses 120ms apart: 5px a frame for three seconds, then 2000px in half
// of one once the presses stopped. Moving a target the loop is already chasing
// costs nothing and keeps the speed that was already there.
assert.ok(
  !/behavior: 'smooth'/.test(plugin),
  'the platform\'s smooth scroll is not used — it restarts rather than retargets',
)
assert.ok(
  /requestAnimationFrame\(step\)/.test(plugin) && /heading\.set\(/.test(plugin),
  'the d-pad eases toward a target of its own instead',
)

// Which somebody who cannot bear the movement must be able to turn off. CSS
// would have honoured this for a `scroll-behavior`; an animation of our own has
// to say so itself.
assert.ok(
  /prefers-reduced-motion/.test(plugin),
  'and reduced motion gets none of it',
)

// And the destination noted has to be one the scroller can actually stop at.
// The DOM clamps the scroll; an unclamped note of where it was heading never
// matches where it lands, so every press afterwards is measured against a page
// that does not exist. Measured on the set: one nudge to the foot of a title
// page and "down" off the last row of More like this jumped into the sidebar.
//
// That page: a grid 2400px tall in a 720px window, so 1680px is as far as it
// goes. A nudge is 0.8 of a screen, and five of them ask for more than exists.
assert.deepStrictEqual(within({ top: 2304, left: 0 }, 1680, 0), { top: 1680, left: 0 }, 'a heading stops where the scroller does')
assert.deepStrictEqual(within({ top: -576, left: 0 }, 1680, 0), { top: 0, left: 0 }, 'and never above the top')
assert.deepStrictEqual(within({ top: 400, left: 0 }, 1680, 0), { top: 400, left: 0 }, 'a reachable one is left alone')
// A row narrower than its own box has nowhere to go: `scrollWidth - clientWidth`
// is negative there, and an unguarded clamp would answer with that.
assert.deepStrictEqual(within({ top: 0, left: 120 }, 0, -40), { top: 0, left: 0 }, 'nothing to scroll is not a negative destination')

// The ease is exponential so that a press landing mid-scroll only moves the
// target — there is no curve to restart. Two properties are what make that
// true, and both are what the platform's smooth scroll would not give.
const half = eased({ top: 0, left: 0 }, { top: 1000, left: 0 }, 16)
assert.ok(half.top > 0 && half.top < 1000, 'a frame closes some of the gap')
// Retargeting keeps the speed already there: one 16ms frame toward a target
// twice as far covers twice the ground, rather than starting from a standstill.
const far = eased({ top: 0, left: 0 }, { top: 2000, left: 0 }, 16)
assert.ok(Math.abs(far.top - half.top * 2) < 0.001, 'moving the target does not restart the curve')
// Same gap, longer frame, more ground — and never past it, whatever the frame
// cost. A dropped second's worth would otherwise teleport.
assert.ok(eased({ top: 0, left: 0 }, { top: 1000, left: 0 }, 64).top > half.top, 'a longer frame covers more')
assert.ok(eased({ top: 0, left: 0 }, { top: 1000, left: 0 }, 5000).top <= 1000, 'and never overshoots')
assert.ok(arrived({ top: 999.9, left: 0 }, { top: 1000, left: 0 }), 'sub-pixel is arrived')
assert.ok(!arrived({ top: 998, left: 0 }, { top: 1000, left: 0 }), 'two pixels is not')

// `nearest` is `scrollIntoView`'s block: 'nearest' computed against the page at
// rest instead of mid-animation, which is the whole reason it is ours. The
// window is the set's, 720px tall with a 64px bar over it.
assert.strictEqual(nearest(300, 480, 64, 720), 0, 'a row already in view does not move')
assert.strictEqual(nearest(20, 200, 64, 720), -44, 'one clipped at the top comes down to the bar')
assert.strictEqual(nearest(700, 880, 64, 720), 160, 'one below the fold comes up by what it overhangs')
// Taller than the window: line the leading edge up and no further, or a long
// card would jump its own top clean past the viewport.
assert.strictEqual(nearest(600, 1600, 64, 720), 536, 'something taller than the window stops at its own top')

// The plugin routes through those rather than keeping arithmetic of its own —
// which is what let the four above be regexes over the source for a release.
assert.ok(
  /within\(to, el\.scrollHeight - el\.clientHeight/.test(plugin),
  'the plugin clamps a heading through `within`',
)
assert.ok(
  /const goal = reach\(el, to\)/.test(plugin) && /eased\(put, goal, gone\)/.test(plugin),
  'and re-clamps each frame, since a grid that mounts a page moves that end',
)

// `shift` is how a rect measured now is read as the rect it will be once every
// scroll of ours has landed.
assert.deepStrictEqual(
  shift(box(300, 800, 184, 321), 0, -517),
  box(300, 283, 184, 321),
  'a box moves with the scroll that has not finished yet',
)

// A press that would leave a region still holding content that way has to
// scroll it instead. A title page's synopsis is prose — nothing above the Play
// row is a target at all — so up went straight to the toolbar and the title,
// poster and overview could never be got back to.
assert.ok(
  /const region = scroller\(from, dir\)/.test(plugin) && /!region\.contains\(/.test(plugin),
  'move() scrolls a region rather than escaping it',
)

// A checkbox or a switch has focus and no caret. Counted as typing, left/right
// off one did nothing, and a button beside it was out of a remote's reach.
assert.match(plugin, /\['checkbox', 'radio'\]\.includes\(/, 'typing() must not treat a checkbox as a field with a caret')

// The name Kotlin evaluates is a string on one side and an assignment on the
// other, so nothing but this notices when one of them is renamed. A miss is
// silent and total: `window.__tvBack` comes back undefined, which reads as "the
// page didn't handle it", and BACK leaves the app from every screen there is.
for (const hook of ['__tvBack', '__tvOk', '__tvHold']) {
  assert.ok(activity.includes(`window.${hook}`), `MainActivity calls ${hook}`)
  assert.ok(plugin.includes(`window.${hook} =`), `and dpad.client.ts still defines it`)
}

// Tauri's own AppPlugin sits above MainActivity on the back dispatcher and pops
// the WebView's history itself unless the page listens for its `back-button`
// event — measured on the set as BACK leaving a film instead of closing the
// subtitle panel. The listener is what hands every BACK to the page, and the
// bridge's `leave()` is the page's only way to background the app at the root.
assert.ok(plugin.includes(`addPluginListener('app', 'back-button'`), 'the page listens for tauri\'s back-button event')
assert.ok(activity.includes('fun leave()') && activity.includes('@JavascriptInterface'), 'and MainActivity exposes leave() on the bridge for the root case')
assert.ok(readFileSync(new URL('../app/utils/platform.ts', import.meta.url), 'utf8').includes('leave?.()'), 'through platform.ts')

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

// --- Text fields a remote can walk past ---------------------------------------
// On a television a field that merely *has* focus puts the on-screen keyboard
// over the whole screen, and a d-pad crosses every field on a settings page on
// its way down it. `TvField` parks each one under a transparent button; a bare
// `<v-text-field>` anywhere else is a screen a remote cannot get past without
// dismissing a keyboard nobody asked for.
// The parking only works if the picker skips what it parks. The input keeps its
// box while inert, and the covering button is `inset-0` over the same box — an
// exact tie, which `pickDirection` gives to the first in document order: the
// input. Focusing an inert element does nothing, so the press was swallowed and
// the field could not be reached at all.
assert.match(
  plugin,
  /el\.closest\('\[inert\]'\)\s*\)[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*return false/,
  'the picker skips inert elements — they cannot take focus, so aiming at one does nothing',
)

// Opening one is the other half, and it went wrong the moment the first half
// started working: `edit()` removes the button the press landed on, which drops
// focus to the body and fires `focusout` with a null `relatedTarget`. Parking on
// that undoes the press a tick before the input is focused — OK on a field did
// nothing at all. Only focus that actually landed somewhere else parks it.
const field = readFileSync(new URL('../app/components/TvField.vue', import.meta.url), 'utf8')
assert.match(
  field,
  /const to = e\.relatedTarget[\s\S]{0,200}&& to &&/,
  'TvField parks only for focus that went somewhere, not for focus going nowhere',
)

function vueFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? vueFiles(new URL(`${entry.name}/`, dir))
    : entry.name.endsWith('.vue') ? [new URL(entry.name, dir)] : [])
}

for (const file of vueFiles(new URL('../app/', import.meta.url))) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes('<v-text-field') || file.pathname.endsWith('TvField.vue'))
    continue
  assert.ok(
    source.includes('<tv-field'),
    `${file.pathname.split('/app/')[1]} has a text field outside <tv-field> — on a TV that raises `
    + 'the keyboard the moment a remote passes it',
  )
}

console.info('d-pad picker: ok')
