---
name: tv-remote-ui
description: How this app stays usable from a TV remote (Android TV / Google TV). Read before adding or changing any interactive UI — a new page, dialog, control bar, list, card, or overlay — and before touching plugins/dpad.client.ts, utils/dpad.ts, or the Android manifest/activity. Triggers on "remote", "d-pad", "dpad", "Android TV", "smart TV", "leanback", "focus", "keyboard navigation", "arrow keys", "back button".
---

# Remote-friendly UI

Ventic runs on desktop **and** on Android TV, where the only input is a d-pad:
**up, down, left, right, OK, back**. No pointer, no hover, no text entry worth
having. Anything you add has to be reachable and legible with those six keys.

## How it already works

`app/plugins/dpad.client.ts` is the whole mechanism, and it is generic — new
pages get remote support for free as long as they follow the rules below.

- **Arrows** move focus to the nearest focusable element in that direction,
  scored by `pickDirection()` in `app/utils/dpad.ts`. Sideways drift is measured
  between the boxes' **edges**, not their centres — boxes that face each other
  at all count as level, or a 44px nav link never reaches the 361px poster
  beside it. Anything level like that beats everything that isn't, however much
  closer: a run along the toolbar has to reach Downloads 264px away rather than
  fall into the grid 74px below. Drift costs double only among equals, which is
  what keeps a grid walking straight down its column.
- The handler sits on `document` in the **bubble** phase and bails on
  `e.defaultPrevented`, so any component that already handles arrows keeps them:
  Vuetify sliders, lists, selects, and the player's seek keys.
- A component may own an axis but never the one that leads *out* of it, or the
  d-pad has no exit but Back. A second handler in the **capture** phase takes
  the key back for the ones that would: up/down off a `[role="slider"]` (whose
  value is left/right, and which otherwise changes as you try to leave), up/down
  off the first/last item of a `.v-list` (which otherwise wraps, so the drawer
  cycles for ever instead of letting go), and left/right off the ends of a
  `.v-slide-group` — chip groups and tabs wrap the same way, which is why the
  category chips circled instead of reaching the genre filter beside them.
- **Only `tabindex="-1"` opts out.** Vuetify's lists rove the tabindex across
  their items and park `-2` on the ones that aren't current — every drawer link
  carries it, and they are all real targets. A wrapper that merely *contains*
  other targets (the `.v-list` div is focusable itself) is not one.
- **Nothing that way?** The page scrolls by 80% of a screen instead (`nudge()`),
  then focus is dropped so the next press lands on the freshly revealed row.
  This is what makes lazily-mounted content (`v-lazy` rows) reachable at all.
- **OK** is plain Enter — the browser clicks a focused `<a>`/`<button>` itself.
  Vuetify's list items and chips handle Enter/Space too.
- **Back** is `window.__tvBack()`: close the top dialog, else let the page claim
  Escape (the player's menus, then leaving playback), else `router.back()`, else
  return `false`, at which point `MainActivity` backgrounds the task. Three things
  have to be true for any of that to run. `handleBackNavigation` must be
  **`false`** — `WryActivity.setWebView` otherwise adds a callback of its own
  that does nothing but `webView.goBack()`, and it wins, because the dispatcher
  runs the last callback added and ours goes on in `onCreate` while wry's goes on
  when the webview is created. That is a silent failure with a plausible face:
  popping a history entry looks exactly like a page-level back until something is
  open in front of it, and at the root `canGoBack()` is false, so the one case
  that ever reached `__tvBack` was the one that backgrounds the app. And the
  override has to sit on
  **`OnBackPressedDispatcher`**, not on `onKeyDown`. An app targeting API 35+ gets
  predictive back, where BACK arrives through `OnBackInvokedDispatcher` and
  `onKeyDown` is never called at all; the manifest declares
  `enableOnBackInvokedCallback` so 33 and 34 take that path too, and the
  dispatcher is what both mechanisms feed. Catching the keycode instead is what
  made Android 15 phones close the app out of dialogs and out of a film.
- **And the WebView answers BACK on its own account, before any of that.** It
  pops its own history whenever `canGoBack()` is true, and it sits *below* the
  activity in the view hierarchy — `super.dispatchKeyEvent` walks the views
  before `onBackPressedDispatcher` is ever consulted. So turning wry's callback
  off was only half the job: the key was still spent on a history pop, and
  `__tvBack` ran only at the root, where there is no history to pop. Measured on
  the box: BACK on a film with the subtitle panel open left the film and never
  closed the panel, and no dialog anywhere could be closed with it.
  `MainActivity` therefore takes `KEYCODE_BACK` in `dispatchKeyEvent` and hands
  it to `onBackPressedDispatcher` itself. Predictive back never calls
  `dispatchKeyEvent`, so that is the older path being routed to the same
  callback, not a second rule.
- **Back at the root backgrounds the app, it does not finish it.** Finishing the
  activity leaves the *process* alive, and wry starts the Rust side exactly once
  per process (a `ProcessLifecycleOwner` observer that ignores being added
  twice), so the next launch built a fresh activity onto an event loop whose
  webview was already gone — and aborted. `moveTaskToBack(true)` avoids all of
  it; `onDestroy` kills the process when the activity is genuinely finishing, so
  a real close is always followed by a cold start. `bun run check:dpad` holds
  both ends of this.
- **Focus is visible** whenever `<html>` carries `.dpad`, added on the first
  arrow key and removed on the first mouse move. The ring lives in the
  `vuetify-final` layer in `assets/css/layers.css`.

Run `bun run check:dpad` after touching the geometry.

## Rules for new UI

1. **Everything actionable is an `<a href>` or a `<button>`.** Not a `div` with
   a click handler — that is unreachable by remote. A custom control that must
   be a div needs `tabindex="0"`, a `role`, and its own Enter/Space handling.
2. **Hover state must also be focus state.** `@mouseenter` needs a matching
   `@focus`, `hover:` needs `focus-visible:` or `group-focus-within:`. A remote
   never hovers, so hover-only affordances are invisible on a TV.
3. **Decorative or duplicate controls get `tabindex="-1"`.** Buttons layered on
   top of a card (favourite, watched, ⋮) would otherwise swallow a d-pad moving
   across the grid. The card is the target; the extras are for pointers.
4. **One obvious first stop.** The layout marks the page region with
   `data-dpad-start`; focus lands on the first thing inside it after a
   navigation. Put the primary action (Play, the first card) early in the DOM.
5. **Don't rely on typing, and don't focus a text field on the way past one.**
   Every screen has to be reachable by moving and pressing OK. In a text field
   left/right belong to the caret and up/down leave it — but on a TV a field
   that merely *has* focus puts the on-screen keyboard over the whole screen,
   and a remote crosses the app bar's search box to reach Downloads and
   Settings. So a field a d-pad can pass sits `inert` under a transparent
   `<button>` (`AppBar.vue`), and OK on that button is what focuses it. It has
   to be a button: the WebView drops OK for an `<input>` it thinks can't be
   edited, and Android only raises the keyboard for a focus that happens inside
   a real press — `nextTick` after the click still counts, a timer seconds later
   does not. `router.afterEach` leaves focus alone while a caret is in play, or
   the debounced search navigation snatches it away mid-word.
6. **Test at 10 feet.** Body text no smaller than `text-body-medium`, targets no
   smaller than ~40px, and never signal state with colour alone at that
   distance.
7. **Keep dialogs modal.** Vuetify overlays trap the d-pad automatically
   (`.v-overlay--active`, tooltips excepted). A hand-rolled overlay has to
   either be one, or accept that the d-pad will walk out of it.

## Android TV specifics

- `gen/android/app/src/main/AndroidManifest.xml` declares
  `android.software.leanback` and `android.hardware.touchscreen` as
  `required="false"` (one APK for phones and TVs), the `LEANBACK_LAUNCHER`
  category, and `android:banner` — a TV launcher shows a blank tile without one
  (`res/drawable-xhdpi/tv_banner.png`, 320×180).
- `gen/android` is committed, so edits there survive; regenerating the project
  will clobber them, so re-apply the BACK callback and the
  `handleBackNavigation = false` beside it, the **OK forward**
  (`dispatchKeyEvent` → `window.__tvOk`), the `VenticScreen` JS interface
  (fullscreen, orientation, metered network, `tv()`), the **wide viewport**
  settings, `mediaPlaybackRequiresUserGesture = false`, `Downloads.kt` with its
  `onResume`/`onPause`/`onDestroy` hooks, the process kill in `onDestroy`, the
  `windowBackground` in `res/values*/themes.xml`, and the manifest lines — the
  leanback ones, `enableOnBackInvokedCallback`, the service and its permissions —
  if that ever happens. `bun run check:android-downloads` fails loudly when the
  download half is gone, and `check:dpad` when the BACK half is.
- **A TV is 960dp wide**, which is a small laptop as far as any breakpoint is
  concerned: below every `lg:` rule the desktop layout is built on, and at twice
  the size anything wants to be across a room. `plugins/tv.client.ts` asks for a
  1280 viewport when `isTv()` (`UiModeManager`, through the bridge — a TV's user
  agent is a phone's), which needs `useWideViewPort` **and**
  `loadWithOverviewMode` in MainActivity: the first lets the page ask for more
  width than the screen has, the second scales it down to fit. With only the
  first, the right quarter of the layout is off the side of the screen. It also
  puts `.tv` on `<html>` for anything that follows from being a TV rather than
  from a width.
- **OK is not a key the page always sees.** The WebView turns DPAD_CENTER into a
  click on a link or a button, and drops it for the readonly `<input>` behind a
  Vuetify select — and it claims the key before the activity's `onKeyDown` runs,
  so the forward has to sit in `dispatchKeyEvent`. `window.__tvOk` opens what it
  can and answers `false` for everything else, and the key is passed on either
  way. Vuetify opens a select on **mousedown**, not on `click()`.
- Volume is the TV's own remote, not the app's — and the phone's own buttons.
  The player hides its volume slider on any coarse pointer for that reason.
- Playback there is the webview's `<video>`, not mpv (`app/utils/htmlvideo.ts`),
  so the player's bars stack in CSS rather than being punched out of a native
  window. A control added to `MpvPlayer.vue` works on both without extra work;
  anything reaching for `player_ipc` directly does not.
- **A set answers `hover: none` and means it**, but the webview still fires a
  `pointerenter` at whatever appears under its idea of where a pointer last was
  — the middle of the screen. One phantom enter with no leave behind it pinned
  the player's chrome open for a whole film, so anything that lets hover hold UI
  up has to check it can hover at all (`hoverable` in `MpvPlayer.vue`).
- Play/pause sits in the bottom bar on a TV (`barTransport`), not in the middle
  of the picture where a thumb would want it: a remote arrives at the bar
  anyway, and the centre cluster is up the longest of anything on screen.

## What has deliberately been left out

- **No overscan padding.** Modern Android TV doesn't overscan. Add a safe-area
  inset only if a real set clips the edges.
- **No focus-scale animation on cards.** The ring plus the existing hover
  overlay is enough; per-card transforms cost frames on TV silicon.
- **No spatial-navigation dependency.** `pickDirection` is ~30 lines and the
  polyfills are far larger than what a poster grid needs.
