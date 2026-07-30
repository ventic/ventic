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
  scored by `pickDirection()` in `app/utils/dpad.ts` (nearest edge gap, with
  sideways drift weighted double so a grid walks straight down its column).
- The handler sits on `document` in the **bubble** phase and bails on
  `e.defaultPrevented`, so any component that already handles arrows keeps them:
  Vuetify sliders, lists, selects, and the player's seek keys.
- **Nothing that way?** The page scrolls by 80% of a screen instead (`nudge()`),
  then focus is dropped so the next press lands on the freshly revealed row.
  This is what makes lazily-mounted content (`v-lazy` rows) reachable at all.
- **OK** is plain Enter — the browser clicks a focused `<a>`/`<button>` itself.
  Vuetify's list items and chips handle Enter/Space too.
- **Back** is `window.__tvBack()`: close the top dialog, else let the page claim
  Escape (the player's menus, then leaving playback), else `router.back()`, else
  return `false` so Android quits. `MainActivity.kt` routes `KEYCODE_BACK` into
  it — without that override the app exits from any screen, because
  `TauriActivity` turns wry's own back handling off.
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
5. **Don't rely on typing.** Search must stay optional: every screen has to be
   reachable by moving and pressing OK. In a text field, left/right belong to
   the caret and up/down leave the field.
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
  will clobber them, so re-apply the BACK override, the `VenticScreen` JS
  interface (fullscreen, orientation, metered network),
  `mediaPlaybackRequiresUserGesture = false`, `Downloads.kt` with its
  `onResume`/`onPause`/`onDestroy` hooks, and the manifest lines — the leanback
  ones, the service and its permissions — if that ever happens.
  `bun run check:android-downloads` fails loudly when the download half is gone.
- Volume is the TV's own remote, not the app's — and the phone's own buttons.
  The player hides its volume slider on any coarse pointer for that reason.
- Playback there is the webview's `<video>`, not mpv (`app/utils/htmlvideo.ts`),
  so the player's bars stack in CSS rather than being punched out of a native
  window. A control added to `MpvPlayer.vue` works on both without extra work;
  anything reaching for `player_ipc` directly does not.

## What has deliberately been left out

- **No overscan padding.** Modern Android TV doesn't overscan. Add a safe-area
  inset only if a real set clips the edges.
- **No focus-scale animation on cards.** The ring plus the existing hover
  overlay is enough; per-card transforms cost frames on TV silicon.
- **No spatial-navigation dependency.** `pickDirection` is ~30 lines and the
  polyfills are far larger than what a poster grid needs.
