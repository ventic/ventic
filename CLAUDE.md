# Ventic

Nuxt 4 + Vuetify 4 front end, Tauri 2 (Rust) back end. A media library over an
embedded BitTorrent engine, playing into a real mpv window that the Rust side
keeps glued to a box in the page. Targets desktop **and Android TV**.

## Working here

- `bun` only (`preinstall` enforces it). `bun run tauri:dev` for the app,
  `bun run dev` for the browser-only front end, `bun run lint` before finishing.
- `bun run build` makes native bundles, `bun run build:windows` a cross-compiled
  `.exe`, `bun run build:android` an APK. `.msi` and macOS need their own OS.
  There is no CI — builds are local. See the README for what plays where.
- The mpv backend has one file per windowing system: X11 in
  `src-tauri/src/player.rs`, Win32 in `player_windows.rs`, macOS in
  `player_macos.rs` (+ `player_render_mac.rs`), and stubs in
  `player_unsupported.rs` for Android. Keep all four in sync when you add or
  change a `player_*` command, or the other targets stop compiling. The IPC
  socket the two unix backends share is `player_socket.rs`.
- **macOS is not a child window, it is libmpv in-process.** The platform embeds
  no other process's window and mpv's Cocoa output takes no `--wid`, so there is
  no process to parent: the app links libmpv, sets `vo=libmpv`, and renders the
  frames itself into an `NSOpenGLView` (`player_render_mac.rs`). Two rules follow.
  The view goes **under** the WKWebView, whose background is switched off while a
  film is up — so macOS uses Android's compositing (`behind`, the `ventic-video`
  class, DOM input) with mpv's protocol, and punches no cutouts. And AppKit, the
  GL context and `mpv_render_context` are all the **main thread's**: hop with
  `run_on_main_thread`, and never hold the `PlayerState` lock across a hop that
  needs it back.
- Control is still the IPC socket even there — libmpv honours
  `input-ipc-server`, so `player_socket.rs` and every command the frontend sends
  work unchanged. The C API is used only to create the handle, load the file and
  tear it down. `player_status` has no process to watch, so it asks
  `idle-active` instead.
- You can type-check the macOS build from Linux, which is worth doing before
  claiming it works: `rustup target add aarch64-apple-darwin` then
  `cargo check --target aarch64-apple-darwin`. It gets as far as
  `objc2-exception-helper`, which compiles a `.m` file — point
  `CC_aarch64_apple_darwin` at any stub that writes an object file (nothing is
  linked during a check).
- Where mpv can't be run at all (Android, a plain browser) the player falls
  back to the webview's `<video>`. `app/utils/htmlvideo.ts` answers the *same*
  mpv command/property protocol, so `MpvPlayer.vue` is one component with one
  `native` flag rather than two players — a new control needs no second
  implementation, but a new mpv property does need a line in the shim's `READ`.
  `bun run check:player` covers the translation.
- The torrent engine hashes pieces with aws-lc, which assembles its x86_64 fast
  paths with **NASM** — a tool Linux has packaged and Windows does not, so a
  Windows build dies in `aws-lc-sys`'s build script long before any of our code.
  `src-tauri/.cargo/config.toml` sets `AWS_LC_SYS_PREBUILT_NASM=1` to take the
  objects the crate ships for that target instead. It is scoped to Windows
  x86_64 by aws-lc-sys itself, so it changes nothing on any other host.
- Linux uses the system mpv; Windows has none, so `scripts/build/mpv.ts`
  downloads one into `src-tauri/mpv/` and `tauri.windows.conf.json` bundles it as
  a resource. The build scripts call that before invoking tauri — a missing
  resource fails the build. macOS is neither: it *links* libmpv, so `brew install
  mpv` is a build dependency, and `build.rs` adds the Homebrew and MacPorts lib
  directories to the linker's search path because neither is on it. The linker
  records those absolute paths, so the .app carries its own copies.
  `scripts/build/macos/bundle-dylib.ts` stages them as `beforeBundleCommand` —
  the one moment when the binary exists and the bundle does not — walking the
  dylib graph with `otool`, rewriting every load command to `@executable_path`
  with
  `install_name_tool`, and `tauri.macos.conf.json` copies `src-tauri/dylibs/`
  into `Contents/Resources/dylibs`. Both tools ship with the Xcode command line
  tools, so mpv stays the only `brew install` a bundle needs. That staging
  directory is created by `build.rs` rather than the script, because
  `tauri_build` resolves its resource glob *during the compile* and fails a
  clone that has never been built, long before the script runs. All of it is
  then ad-hoc signed: rewriting a Mach-O invalidates its signature, and Apple
  Silicon kills a process whose signature is broken rather than ignoring it.
  `bun scripts/build/macos/bundle-dylib.ts <path.app>` re-checks a finished
  bundle, which is the only way to see the failure — the build machine has
  Homebrew, so a dylib left behind resolves fine there and nowhere else.
- **The volume levelling is one setting and two implementations**, because
  there is no filter graph on Android. `app/utils/audio.ts` owns both: mpv is
  handed a `lavfi` chain over the `af` command (dynaudnorm for the levelling,
  and for the dialogue boost a `pan` that lifts the centre channel of a 5.1 mix
  — the layout is echoed back from `audio-params/channels`, and a stereo track
  falls back to a bell around 2 kHz), while ExoPlayer is sent the two settings
  themselves and `Player.kt` puts them on the platform's own LoudnessEnhancer
  and Equalizer. A chain mpv rejects answers `error running command` and keeps
  playing, which is what the retry in `applyAudio` is for. `bun run check:audio`
  holds the chain and that Kotlin seam.
- Playback starts through `downloads.start(key, …)`, never `startTorrent`
  directly: the store files the info hash under the title's progress key
  (`ventic.cached`), and that map is what lets an already-downloaded film play
  with no TMDB lookup, no source search and no peers. Call the util straight and
  the title silently loses its offline copy.
- Logic worth trusting has a `bun run check:*` script beside it
  (`check:dpad`, `check:torrents`, `check:subtitles`, `check:theme`,
  `check:library`, `check:player`, `check:swipe`, `check:boot`,
  `check:perf`, `check:android-downloads`, `check:updates`, `check:supporters`,
  `check:audio`, `check:i18n`).
  Add to those rather than pulling in a test framework. `bun run check:types` is
  the odd one out: a whole-app `vue-tsc` pass, which is the only thing that
  reads a template's bindings against its script's types — eslint never does.
  It needs a real `typescript` in `node_modules`, which is what the
  `resolutions` pin in package.json is for; vue-tsc patches `tsc.js` at load and
  a stripped redistribution has nothing to patch.
- **Every theme is generated, then contradicted.** `scheme()` in
  `app/theme/palette.ts` turns one colour into the whole MD3 token set with
  Google's own generator (`@material/material-color-utilities`), and `build()` in
  `themes.ts` lays a theme's hand-picked surfaces back over it — so a theme is
  the two or three colours it is actually *about*, and the forty-odd roles
  nothing here picks still exist and still contrast. Don't add a colour to one
  theme's `colors` block alone: it silently goes missing from the other 27. The
  user's own palette is different again — `generated`/`generatedLight` are
  placeholders registered at boot whose colours are recomputed from
  `settings.source` in `applyTheme`, because Vuetify sizes its stylesheet from
  the themes it was built with and can't be handed a new one at runtime.
- **`app/theme/presets.ts` is the whole registry**, one entry per theme: the
  Vuetify palettes, the settings grid and the order it lists them in are all
  derived from that table, so adding a theme is adding an entry and nothing
  else. A theme is a *preset* — it can also name the `backdrop` it was drawn for
  (mode, a picture in `public/backgrounds/`, blur, tint), which is written onto
  the `ui` store the moment it is picked and is the user's to move afterwards.
  What a theme leaves out it leaves alone, so a change of colour never wipes a
  picture they chose themselves.
- **A TV's GPU is the budget, not its CPU.** Profiling the set showed paint and
  raster taking essentially the whole frame while style, layout and script
  together stayed under a tenth of it — so the thing to count on a new screen is
  blurred and animated *area*, not components or renders. Two rules follow.
  `backdrop-filter` is a frame-buffer readback: it is affordable once on the
  chrome, never per-item in a list (twenty rating badges cost a quarter of the
  frame rate for an effect invisible at 43x20). And anything mounted in bulk
  wants `content-visibility: auto` with a `contain-intrinsic-size` — it is worth
  more than everything else here put together (2.2x on the browse pages), and
  the reserved size has to be right or the scrollbar jumps. The effects that
  can't be made cheap sit behind `settings.reduceEffects` instead, which is one
  class on `<html>` and one block in `assets/css/layers.css` — put new ones
  there rather than teaching a component about the setting. `bun run check:perf`
  holds the shape of it; the numbers are in that script's header.
- **On Android the process is the app, and it gets exactly one `run()`.** wry
  starts the Rust side from a `ProcessLifecycleOwner` observer that ignores being
  added a second time, so a `finish()`ed activity in a process Android kept alive
  meant the next launch attached a fresh activity to an event loop whose webview
  was gone — an abort, reported as "I closed it and opened it again and it just
  crashed". So BACK at the root calls `moveTaskToBack(true)`, and `onDestroy`
  kills the process whenever the activity is genuinely finishing: `run()` binds
  port 3030 and opens a librqbit session, and a cold start is the only state it
  is written for. Nothing in `MainActivity` may call `finish()`. BACK itself is
  answered on `OnBackPressedDispatcher` rather than `onKeyDown`, because
  predictive back (declared in the manifest, and unconditional from API 35) never
  calls the latter. `bun run check:dpad` covers all of it.
- The engine runs *inside* the app process, so on Android "the user opened
  another app" means "the download stopped": the process is cached and then
  frozen. `DownloadService` (`gen/android/.../Downloads.kt`) is the foreground
  service that exempts it, started from `MainActivity`'s `onResume`/`onPause` —
  `onPause` because API 31+ refuses a promotion to foreground once the app is
  gone. It polls the engine's HTTP API rather than trusting anything the page
  pushes, because a webview off screen has its timers throttled to a crawl.
- *Only download on Wi-Fi* (`settings.wifiOnly`) is enforced in the downloads
  store, not in Kotlin: `planNetwork` pauses background torrents and starts back
  exactly the ones it paused, never one the user paused, and never the film being
  watched. Whether the network is metered can only come from Android
  (`navigator.connection` can't tell) — `metered()` on the `VenticScreen` bridge,
  so `meteredNetwork()` is `null` everywhere else and the setting hides itself.
  Nothing resumes while the app is closed: with no download running there is no
  foreground service, so the process is frozen.
- A **release** from a source is a torrent *or* a plain `url` (that's what a
  debrid addon returns). `Release.url` set means no engine, no disk and no
  swarm: `startTorrent` returns it as `Started.url`, `watch.vue` plays it
  directly, and `pickBest` exempts it from the seeder check and the disk
  budget. Anything that assumes a hash needs a `t.url` branch.
- **The library is local and nothing syncs it.** There is no account, no server
  and no third-party service: `stores/library.ts` writes four localStorage maps
  and `app/utils/backup.ts` is the only way one moves between machines. Trakt
  used to be the second copy and was taken out when it stopped being free —
  don't reintroduce a sync client, a scrobbler or a "connect an account" button
  on the way to something else. *Settings → Account* says a sync isn't supported
  yet, and that panel is where the real one lands.
- Go through the store for watch state anyway: `record`, `finish`, `setWatched`,
  `toggleFavourite`, `toggleWatchlist` own the rules about what counts as
  watched. Don't write `progress`/`favourites`/`watchlist` from a component.
- Favourites and the watchlist are two localStorage keys sharing one `toggle`
  that takes the list name. Neither is capped and nothing gates either button.
- `app/utils/backup.ts` carries every `ventic.` localStorage key by design, so a
  new preference is in the backup the day it's added. A key holding a
  credential must go in its `SECRET` set.
- **Ko-fi has no read API**, so the supporter list is `supporters.json` at the
  repo root, read live off `raw.githubusercontent` by *Settings → Support*
  (`app/utils/supporters.ts`). Edit that file on GitHub to thank someone — it
  needs no release, and the app never talks to ko-fi.com. The parser drops
  anything it can't read rather than failing the page, because a hand-edited
  file reaches users before any build does; `bun run check:supporters` holds
  that. Ko-fi's only machine-readable output is a webhook, and there is no
  server to receive one.
- **The updater is opt-in per install, and the default is no.** Two separate
  questions, answered in two places. *Is there a newer one* is
  `app/utils/updates.ts`: the GitHub API, which every build can reach — the
  release file the updater itself reads redirects to a host that sends no CORS
  header at all, so a webview can't fetch it. *May this copy replace itself* is
  `can_self_update` in `lib.rs`, and it says yes only to a bundle the tauri
  bundler packaged (AppImage with `$APPIMAGE` set, .msi, NSIS, .app). A `.deb`,
  an `.rpm`, an AUR or Nix build and a bare `cargo build` all get no — dpkg and
  rpm hold a hash of every file they own, and an unrecognised bundle falls
  through the plugin's *AppImage* path, which renames the binary away and writes
  over it. Everything else in the panel follows from that bool; don't add a
  platform check beside it.
- **Android is the third answer, and it isn't the updater plugin.** No app may
  overwrite its own package there — it can only download an APK and ask the
  system installer to take it, which is one confirmation away from the same
  thing. That is `installUpdate`/`updateProgress` on the `VenticScreen` bridge
  (DownloadManager, then an `ACTION_VIEW` through the FileProvider), so the
  store's `canUpdate` — not `capable` — is what the panel asks, and `install()`
  picks the path. The safety is Android's own: it replaces a package only with
  one signed by the same key, and keeps the library when it does. `bun run
  check:updates` holds that bridge seam, which no compiler sees. Anyone who has
  to fetch a build by hand (a `.deb`, an AUR build, a browser) goes to
  `DOWNLOAD_URL`, the project's own page — the GitHub release is six files with
  no word on which one this machine wants.
- **The AppImage is rewritten after it is signed.**
  `scripts/build/linux/appimage.ts` strips libwayland and repacks *after*
  tauri-action has already put a signature for the original file into
  `latest.json`, so the release ships an artifact the updater refuses. The
  workflow signs the repacked file again and a separate `updater` job
  (`scripts/build/linux/appimage-signature.ts`) puts that signature in the
  manifest — separate because all three desktop runners read-modify-write
  `latest.json` in parallel, and a patch from inside the Linux job loses the
  race. Touch either script and check the other still matches.
- Cargo resolves `[target.'cfg(…)'.dependencies]` against the **target triple
  only**. Tauri's `desktop`/`mobile` cfgs are emitted by `tauri-build` and work
  in `#[cfg(…)]` but not there — a dep gated on `cfg(desktop)` is silently never
  linked. Spell the triples out (see `tauri-plugin-single-instance`).
- `tauri_plugin_single_instance` must be the **first** plugin registered, or a
  second launch won't forward its deep link to the running app.
- **A white screen is a bug report with nothing in it.** The bundle is built for
  Chrome 111 (Vite's default target, and Vuetify calls `Array.prototype.toSorted`
  besides), so a webview older than that can't parse it — and a script that never
  parses paints nothing, leaving the activity window behind the transparent
  webview. `app/boot-diagnostics.js` is inlined into the head by `nuxt.config.ts`
  to answer that: it is ES5 with no bundler anywhere near it *because* it has to
  run where the app couldn't. It shows *two* screens, because a slow start and a
  dead one look identical: "Starting…" with a moving ellipsis at 2.5s, and the
  full diagnostic at 12s (or 1.2s after an error) — and only ever while `#__nuxt`
  is still empty. The moving ellipsis is the diagnostic, not the decoration: it
  separates "the webview runs our code and the bundle is slow" from "nothing here
  runs at all", which is the one thing a photograph of a dark screen can't say.
  Every error also lands on `window.__venticBoot` for adb and devtools. Keep
  `NEEDS` in it honest if the build target ever moves.
- **One colour, four files, none of which can import the other three.** Three
  layers can be seen before the page paints anything — the native window, the
  webview, and `html` before a stylesheet lands — and left alone all three are
  white. That was two visible white flashes on Windows (the Win32 window, then
  WebView2) and the platform's own colour on Android. `GROUND` in
  `app/theme/themes.ts` is the default theme's background and the only place it
  is worked out; `tauri.conf.json` (`backgroundColor`, which tauri hands to both
  the window and WebView2), `res/values/colors.xml` and the head `<style>` in
  `nuxt.config.ts` all have to say the same thing, and `bun run check:boot`
  asserts they do. The static colour is only right for the *default* theme, so
  `utils/ground.ts` writes whatever is actually on screen to `ventic.ground` and
  the boot script puts it back before the first frame — otherwise a light theme
  just trades a white flash for a dark one. Set it on `html` and never on `body`:
  body's background belongs to the theme in the `app` layer, and an unlayered
  rule would beat every layer for good.

- **Every string on screen is `$t('the English text')`, and nothing else.** The
  key *is* the English sentence, so `en.ts` maps each key to itself and English
  can never drift from the source. Write the call and run `bun run i18n`: it
  scans `app/**` and rewrites `i18n/locales/<code>.ts` for all 72 languages,
  filling the new ones with `TODO_TRANSLATION: <key>` for an AI pass to
  replace. There is nothing to import (`$t` is auto-imported from
  `app/utils/i18n.ts` in script and injected by vue-i18n into every template)
  and nothing to name — no `<i18n>` blocks, no local scopes, one catalog per
  language. `bun run check:i18n` fails when the catalogs are behind the source.
  Only string literals are scanned; `$t(name)` can't be.
- A `TODO_TRANSLATION:` value is stripped at runtime (`i18n/i18n.config.ts`), so
  an unfinished language renders as English line by line rather than showing the
  marker. That same file swaps in a **flat message resolver** — keys are
  sentences and contain full stops, which vue-i18n would otherwise walk as a
  path — falling back to a path walk for the one nested thing in a catalog,
  Vuetify's own `$vuetify` object.
- **An options table built at module load can't call `$t` yet**, so its labels
  are functions: `SECTIONS`, `FILTERS`, `LAYOUTS`, `BACKDROP_MODES`,
  `TORRENT_STATUS` and `MENU_TITLES` all hold `title: () => $t('…')` and are
  called at the point of use. Inside a component, a plain `computed` is enough.
- **The language picker's flags are the only icons that aren't `@mdi/js`.** A
  country flag emoji is two regional indicator letters — Windows ships no glyph
  for the pair and a TV draws "SI" — so they are Twemoji pictures through
  `@nuxt/icon`. `flag()` in `app/utils/flag.ts` derives the icon name from the
  locale's `language` tag with `Intl`, so nothing is hand-kept but ICU's
  Türkiye/Turkey rename; nuxt.config maps the same function over the locale
  list to fill `clientBundle.icons`, because the name is computed and
  `scan` can't see it. `provider: 'none'` and `serverBundle: false` on purpose:
  a `tauri://` origin has no Nitro behind it and no promise of a network to
  reach api.iconify.design over, so an icon that isn't in the bundle is a blank.
- **The language list is TMDB's**, regenerated by `bun run i18n:locales` into
  `i18n/i18n.locales.json` — the single source of truth shared by
  `nuxt.config.ts` and both scripts. It folds TMDB's 144 regional tags to one
  entry per language, because 22 flavours of English is a metadata distinction
  and not a UI one; `Intl` answers which region represents a language, what it
  is called in itself, and which four are right-to-left, so no table of language
  names is hand-kept. The full tag survives as `language` and is what `tmdb()`
  asks for, so film data arrives in the reader's language.
- **No language in the URL** (`strategy: 'no_prefix'`), so a path is just a
  path and `setLocale` swaps the catalog in place without navigating. Prefixed
  routes are for crawlers and shareable localised links; a bundle behind a Tauri
  webview has neither, and the one thing they did buy was a Back button that
  undid a language switch — every history entry named a language, so stepping
  back past the switch switched it back. The `localePath()` calls and
  `useRouteBaseName()` are left in place: they are the identity today and are
  what would make putting the prefix back a config change. Scripts and
  templates both call the auto-imported `localePath()` from `app/utils/i18n.ts`
  rather than the module's `$localePath` — that one is typed for route *names*,
  and the wrapper is the single place that hands it a path. The choice is
  remembered in `ventic.locale` and restored in `app.vue` — not in this module's
  cookie, which a `tauri://` origin does not reliably keep, and which no backup
  would carry.
- **A settings section is a page, not a branch.** Every section under
  *Settings* is a route (`pages/settings/<value>.vue`, and Appearance's three
  tabs one level further down), so Back walks them and a reload comes back to
  the one that was open. `SECTIONS` in the settings store is still the whole
  registry — a `value` is the route segment, so adding a section is an entry
  there plus the page file. `pages/settings.vue` is the shell that holds the
  heading and `<nuxt-page>`; `pages/settings/index.vue` only redirects to the
  first section, because a section with two URLs is a section with none.
- Vuetify's own labels come through vue-i18n once `@nuxtjs/i18n` is installed
  (vuetify-nuxt-module swaps its locale adapter), so each generated catalog
  *imports* them — `import { sl as $vuetify } from 'vuetify/locale'` — rather
  than inlining 200 strings 72 times. Vuetify ships 39 of the 72, and the other
  33 rendered a raw `$vuetify.close` on screen: those import `i18n/vuetify/<code>.ts`
  instead, which is hand-written and which the script only ever *imports* — it
  never reads, rewrites or deletes one. Those are deliberately partial (the keys
  the components we actually mount can render, and no more), because a missing
  key falls back to English one at a time; see `i18n/vuetify/README.md`.
- `app/utils/*` and `app/composables/*` are auto-imported; so are Vuetify
  components and the Tauri wrappers in `app/modules/tauri.ts`.
- The `check:*` scripts run these files under `bun` with no Nuxt around them, so
  anything reaching `app/utils` imports `./i18n-stub` first — value-as-key makes
  the identity `$t` exactly what the app renders in English.
- Comments explain *why*, not what. Match that.

## The app ships with no sources — keep it that way

Ventic searches only the servers a user adds under *Settings → Sources*. That is
a deliberate line, not an oversight, and it is the whole reason this project can
be published:

- **Never add a default, fallback, suggested or hard-coded source URL** — not in
  `app/utils/torrents.ts`, not in the settings store's default, not as an
  "example" in a placeholder, the README, a comment, or the UI. The empty list
  is the feature.
- **Don't add a source registry, directory, auto-discovery, or bundled list**,
  and don't link to a specific source from anywhere in the repo. A user typing a
  URL they found themselves is the entire onboarding flow.
- A source is a plain HTTP+JSON endpoint (Stremio addon protocol). Don't grow
  this into a plugin runtime that executes third-party code — it buys nothing
  and adds an RCE surface.
- `ventic://` deep links stage a source and **always ask before adding it**
  (`plugins/deeplink.client.ts` → `ui.pendingSource` → the dialog in
  `pages/settings/sources.vue`). Never add one straight from a link: a web page must
  not be able to change what the app searches. Publishing such a link is for
  *other people's* sites — don't add one to this repo.
- Naming: a **source** is a configured server; a **release** is one result it
  returned. Don't blur them in UI copy.
- The engine, the magnet paste box and the downloads UI are a general-purpose
  torrent client and stay useful with zero sources. Don't gate them behind one.

`bun run check:torrents` covers the empty-list, fan-out and dedupe behaviour.

## Every UI change is also a TV change

The app is driven by a remote — up, down, left, right, OK, back — as often as by
a mouse. **Read `.claude/skills/tv-remote-ui/SKILL.md` before adding or changing
any interactive UI**: pages, dialogs, lists, cards, control bars, overlays.

The short version: real `<a>`/`<button>` elements only, every `hover:` needs a
`focus` twin, decorative overlay buttons take `tabindex="-1"`, and nothing may
depend on typing or pointing. `app/plugins/dpad.client.ts` handles the rest.
