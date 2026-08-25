import { isTauri } from '@tauri-apps/api/core'

/**
 * Where the last painted background colour is left for the next launch.
 *
 * A `ventic.` key, so app/utils/backup.ts carries it like any other preference —
 * which is right: restoring a backup restores the theme, and the ground is that
 * theme's own colour.
 */
const KEY = 'ventic.ground'

/**
 * Tell every layer under the app what colour the app is.
 *
 * Three surfaces can be seen before a single line of the page has painted, and
 * left alone all three of them are white. On Windows that was visible as two
 * flashes on the way in — the Win32 window, then WebView2, then at last a themed
 * page — and on Android as a white or dark-grey rectangle depending on the
 * system theme rather than on ours. The static half of the answer is
 * `GROUND` in theme/themes.ts, written into tauri.conf.json,
 * res/values/colors.xml and the document head at build time.
 *
 * This is the other half: the static colour is the *default* theme's, and
 * somebody running a light theme would only have traded a white flash for a dark
 * one. So the colour actually on screen is written down here every time it
 * changes, and boot-diagnostics.js — which is inlined ahead of the bundle and so
 * runs before anything can paint — puts it back on the next launch.
 *
 * The native call is the same colour again for the window layer, which is what
 * shows through while a window is being resized faster than the webview can
 * follow. It is deliberately not awaited and never fatal: Android has no window
 * to colour, a browser has no Tauri at all, and neither is a reason to leave the
 * theme half-applied.
 *
 * `unknown` in, because the caller has a Vuetify palette slot and Vuetify types
 * one as anything a colour can be — a number, an HSV object. `ramp` in
 * theme/themes.ts only ever puts a hex string there, and the narrowing below is
 * what says so without a cast at the call site: an entry that somehow wasn't a
 * string would paint `[object Object]` on every layer at once.
 */
export function rememberGround(colour: unknown) {
  if (typeof colour !== 'string' || !colour)
    return

  document.documentElement.style.backgroundColor = colour

  try {
    localStorage.setItem(KEY, colour)
  }
  catch {
    // Site data switched off. The next launch gets the default ground, which is
    // the right colour for everyone who has not changed their theme.
  }

  if (!isTauri())
    return

  useTauriWebviewWindowGetCurrentWebviewWindow()
    .setBackgroundColor(colour)
    .catch(() => {
      // No window layer to colour (Android), or a webview that won't take one.
    })
}
