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
- Playback starts through `downloads.start(key, …)`, never `startTorrent`
  directly: the store files the info hash under the title's progress key
  (`ventic.cached`), and that map is what lets an already-downloaded film play
  with no TMDB lookup, no source search and no peers. Call the util straight and
  the title silently loses its offline copy.
- Logic worth trusting has a `bun run check:*` script beside it
  (`check:dpad`, `check:torrents`, `check:subtitles`, `check:theme`,
  `check:library`, `check:player`, `check:swipe`,
  `check:perf`, `check:android-downloads`). Add to
  those rather than pulling in a test framework.
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
- Cargo resolves `[target.'cfg(…)'.dependencies]` against the **target triple
  only**. Tauri's `desktop`/`mobile` cfgs are emitted by `tauri-build` and work
  in `#[cfg(…)]` but not there — a dep gated on `cfg(desktop)` is silently never
  linked. Spell the triples out (see `tauri-plugin-single-instance`).
- `tauri_plugin_single_instance` must be the **first** plugin registered, or a
  second launch won't forward its deep link to the running app.
- `app/utils/*` and `app/composables/*` are auto-imported; so are Vuetify
  components and the Tauri wrappers in `app/modules/tauri.ts`.
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
  `settings/Sources.vue`). Never add one straight from a link: a web page must
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
