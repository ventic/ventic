# Roadmap: Ventic vs Stremio and Nuvio

Research from 2026-09-17: Nuvio's source (TV, mobile and desktop repos), `stremio-web`, the
Stremio Supporters announcement, and the most-upvoted open feature requests on both projects.
Numbers like **+65** are upvotes on an open request.

## Where Ventic is already ahead

| | Ventic | Stremio | Nuvio |
|---|---|---|---|
| Torrents | Full in-process client: seeding, limits, file picks, disk budget, Wi-Fi only, auto stream-vs-keep | Streaming cache; download manager is **paid** ($39.99/yr), desktop + Android phone only | Separate TorrServer binary (macOS flags it as malware); HTTP-only downloads, phone only |
| VPN kill switch | Interface bind | Open request (+12), SOCKS5 (+23) | None |
| Dialogue boost / levelling | Yes | **2nd most-upvoted request** (+65) | Plain gain only |
| Cast to your own TV | Ventic→Ventic, pairing code, position, local files | Chromecast only | None (open request) |
| IPTV | M3U + Xtream native | Addons only | None (open requests) |
| Account | None; WebDAV sync you own, per-entry merge | Stremio account | Nuvio account on their Supabase |
| In-app update on Android TV | Yes, Play-aware | **3rd most-upvoted request** (+64) | Yes |
| Subtitle auto-sync to audio | Free (desktop) | Paid, desktop/web | Open request (+12) |
| Themes | 28 free + backdrops | None | Colours sold to supporters |
| UI languages | 72 | — | 24 |
| Third-party code | None (HTTP+JSON sources) | HTTP addons | JS plugins + CloudStream extensions |

The pitch: they are addon browsers that assume a paid debrid; Ventic owns the bytes — works
without debrid, keeps your films, stays behind the VPN, no account, casts to your own TV.

Not a differentiator against these two: the player. Stremio desktop is mpv, Stremio Android TV
added mpv in 2026, Nuvio TV ships libmpv + ExoPlayer with Dolby Vision conversion and AFR.

## Where they are ahead

iOS / Apple TV and Samsung / LG · profiles (Nuvio free, Stremio paid) · skip intro/credits ·
calendar and new-episode notifications · native debrid resolving and cloud library (Nuvio) ·
catalog addons and collections · Android TV polish: AFR, Dolby Vision conversion, launcher row
(Nuvio) · configure-from-phone over LAN (Nuvio) · Trakt/Simkl/MDBList · Chromecast, external
player, Discord presence.

## The plan

One at a time, in this order. Each item names where it starts and what proves it works.

### 1. [ ] Auto-download the next episode / the rest of the season

- **Why:** Stremio "download next episode" +23, "preload/buffer/download" +36; Nuvio "pre-fetch
  next episode", "download full season" +8. Neither has an engine that can do it; Ventic does.
- **What:** past ~80% of an episode, queue the next one in the background. A "download the rest
  of the season" action on the season page.
- **Starts at:** `nextEpisode()` in `app/utils/library.ts`, called from `app/pages/watch.vue`;
  `start()` in `app/stores/downloads.ts` (always through the store — it files the hash under the
  progress key). Respect `shouldStream` (a stream-only device must not queue a download),
  `wifiOnly` and the disk budget.
- **Platforms:** all with the engine.
- **Done when:** `check:torrents` covers "queues next, skips when stream-only / over budget /
  last episode".

### 2. [x] Phone as the keyboard for the TV

- **Why:** onboarding is "type a URL", the worst thing to do with a remote. Nuvio TV serves a
  LAN page behind a QR code for exactly this.
- **What:** the TV shows a QR code + address; the phone opens a single form: source URL, M3U
  URL or Xtream login, WebDAV address. The TV still shows the confirm dialog — the "always ask
  before adding a source" rule holds.
- **Starts at:** the receiver in `src-tauri/src/cast.rs` (`cast_receive`, port 3232, pairing
  code) — one more route; `ui.pendingSource` and the dialog in `pages/settings/sources.vue`.
- **Platforms:** Android TV first; desktop gets it free.
- **Done when:** `check:cast` covers the route refusing a wrong code and never adding without
  the dialog.
- **Done:** two routes on the receiver (`GET /` serves `cast_setup.html`, `POST /ventic/setup`
  takes the form), `pages/settings/phone.vue` shows the QR and holds the port open through
  `ui.pairing`, and `components/SetupDialog.vue` — mounted by the settings layout — is the one
  thing that keeps any of it. `ui.pendingSource` became `ui.pending`, a `CastSetup` with a
  `kind`, so the `ventic://` link and the phone ask the same question.

### 3. [ ] Local profiles

- **Why:** Nuvio's are free but need an account; Stremio's are paid. A shared living-room TV
  needs them.
- **What:** watch state per profile (`ventic.progress`, `favourites`, `watchlist`, `media`,
  `deleted`, audio per title), a picker at start, optional PIN. Preferences stay shared.
- **Starts at:** `app/stores/library.ts` keys; `app/utils/backup.ts` and `app/utils/sync.ts`
  (profile keys must travel and merge; `groupOf` / `NEVER`).
- **Platforms:** all.
- **Done when:** `check:library` and `check:sync` cover two profiles never seeing each
  other's progress and merging independently.

### 4. [ ] Skip intro / credits

- **Why:** paid in Stremio; Nuvio uses IntroDB, AniSkip, anime-skip.
- **What:** desktop: mpv `chapter-list` titles (Intro, Opening, OP, Credits, Ending, ED) →
  a Skip button. Anime: AniSkip (free, no key) by MAL id + episode. Credits → "Next episode"
  earlier.
- **Starts at:** `app/components/MpvPlayer.vue`; `app/utils/htmlvideo.ts` for the ExoPlayer
  side (media3 exposes no MKV chapters, so Android gets the AniSkip route only).
- **Shares** chapter reading with #14.
- **Done when:** `check:player` covers chapter-title matching and the AniSkip response parse.

### 5. [ ] Episode calendar + new-episode badge

- **Why:** Stremio has a calendar, and "calendar on Android TV" is +44; Nuvio has release
  notifications.
- **What:** for shows in favourites, the watchlist or in progress, TMDB `next_episode_to_air`
  → a calendar view, a badge on the card, a local notification on air day. No account.
- **Starts at:** `app/utils/tmdb.ts` (add `next_episode_to_air` to the raw type);
  `tauri-plugin-notification` is already a dependency.
- **Platforms:** all.
- **Done when:** a `check:*` covers which shows are included and the air-date bucketing.

### 6. [ ] Media keys / system media controls

- **Why:** Stremio +38; Nuvio desktop asks for MPRIS and media keys.
- **What:** Linux MPRIS (`zbus` is already a dependency — follow `awake.rs`), Windows SMTC,
  macOS `MPNowPlayingInfoCenter`, Android `MediaSession` (remote play/pause, Assistant "pause").
  Title, poster, play/pause/seek.
- **Starts at:** `src-tauri/src/awake.rs` as the pattern (one command, three platform bodies,
  a no-op where not needed); `MpvPlayer.vue` calls it; `Player.kt` for Android.
- **Done when:** `check:player` holds the command name across the files that must agree.

### 7. [ ] SOCKS5 proxy for the engine

- **Why:** Stremio +23. The vendored librqbit already takes one (`socks_proxy_config` in
  `src-tauri/vendor/librqbit/src/session.rs`).
- **What:** one field under *Settings → Network → VPN*, a file in app data like the VPN
  setting (the engine starts before any page), restart the session loop when it changes.
- **Starts at:** `run_torrent_server` in `src-tauri/src/lib.rs`, `src-tauri/src/vpn.rs`.
- **Credential in the URL** → the key goes in `backup.ts`'s `SECRET` set.
- **Done when:** a `cargo test --lib` in the style of the VPN one: no byte reaches a seeder
  except through the proxy.

### 8. [ ] Auto frame rate on Android TV

- **Why:** Nuvio has it; 24p films judder on a 60 Hz panel.
- **What:** switch the display mode to the film's frame rate (media3
  `setVideoChangeFrameRateStrategy` / `Surface.setFrameRate`, Android 11+), a setting to turn it
  off, restore on exit.
- **Starts at:** `ensure()` in `src-tauri/gen/android/app/src/main/java/com/ventic/app/Player.kt`.
- **Platforms:** Android only. Test on the TPM191E.
- **Done when:** `check:player` holds the setting across the bridge.

### 9. [ ] Random episode button

- **Why:** Nuvio's single most-upvoted request (+34).
- **What:** on a show's page, play a random episode (optionally unwatched only).
- **Starts at:** `app/pages/[type]/[id].vue`, `nextEpisode()`'s neighbour in `utils/library.ts`.

### 10. [ ] Hide watched

- **Why:** Stremio +25.
- **What:** a toggle on the browse bar that drops watched titles from lists.
- **Starts at:** `app/components/MediaBrowser.vue`, `OptionsBar.vue`.

### 11. [ ] Crop / zoom to fill

- **Why:** Stremio +24 (ultrawide films with black bars).
- **What:** a player toggle: mpv `panscan`; ExoPlayer `RESIZE_MODE_ZOOM`.
- **Starts at:** `MpvPlayer.vue`, `htmlvideo.ts` (`READ` needs the property), `Player.kt`.

### 12. [ ] Audio delay

- **Why:** Stremio +23; Ventic has subtitle delay only.
- **What:** mpv `audio-delay`; ExoPlayer needs a delaying audio sink or processor.
- **Starts at:** `MpvPlayer.vue` next to `sub-delay`, `app/utils/keys.ts`.

### 13. [ ] Episode ratings heatmap

- **Why:** Nuvio +26.
- **What:** a season × episode grid coloured by TMDB `vote_average` on the show page.
- **Starts at:** `app/utils/tmdb.ts` seasons, `app/pages/[type]/[id].vue`. Must be d-pad
  reachable or purely decorative.

### 14. [ ] Chapter marks on the seek bar

- **Why:** Stremio +18.
- **What:** ticks from mpv `chapter-list` on `PlayerSlider.vue`; chapter next/prev keys.
- **Platforms:** desktop (mpv). Shares chapter reading with #4.

### 15. [ ] Anime4K / upscaling shaders

- **Why:** asked for on Nuvio desktop.
- **What:** a player preset setting mpv `glsl-shaders` to bundled Anime4K shaders (MIT).
- **Platforms:** desktop. Mind `bun run build:windows` bundling and the macOS libmpv render path.

## Deliberately left out

These conflict with rules already in `CLAUDE.md`:

- Trakt / Simkl / AniList scrobbling — Trakt was removed on purpose.
- Internet watch party — needs a relay; the LAN-only line holds.
- Plugin runtime / CloudStream extensions — an RCE surface.
- Bundled catalogs, suggested sources, source directories.

## Big bets, not features

- **iOS / Apple TV** — the macOS libmpv render path could carry over; sideload-only in
  practice (Stremio was pulled from the App Store in January 2026).
- **Samsung / LG** — a webview only: no engine, the `url` path only.
- **Usenet** — Stremio ships it in its AltStore build; Nuvio +8.
- **Jellyfin as a source** — a user's own server, fits the ethos; a project on its own.

## Sources

- [Stremio Supporters](https://blog.stremio.com/stremio-supporters-a-way-to-sustain-our-development/),
  [Stremio blog](https://blog.stremio.com/),
  [Stremio review 2026](https://www.firesticktvstream.com/stremio-review-2026/)
- [Nuvio vs Stremio 2026](https://www.geekextreme.com/nuvio-vs-stremio-2026-free-profiles/),
  [What is Nuvio](https://iptvranking.com/what-is-nuvio/),
  [Nuvio, STRMR, ARVIO](https://quickfever.com/nuvio-strmr-arvio)
- Source: [NuvioTV](https://github.com/NuvioMedia/NuvioTV),
  [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile),
  [NuvioDesktop](https://github.com/NuvioMedia/NuvioDesktop),
  [stremio-web](https://github.com/Stremio/stremio-web)
- Requests: [stremio-features](https://github.com/Stremio/stremio-features/issues) and the
  Nuvio issue trackers, sorted by reactions
