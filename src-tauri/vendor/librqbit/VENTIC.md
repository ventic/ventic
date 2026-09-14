# librqbit, with Ventic's patch

This is librqbit 9.0.0-rc.0 as crates.io ships it, minus its web UI and its
packaging files, plus one change: a torrent can be **streamed** instead of
downloaded. Cargo takes it from here through `[patch.crates-io]` in
`src-tauri/Cargo.toml`, and `../librqbit.patch` is the whole diff — read that
rather than this folder.

No release of librqbit can do either half of it (9.0.1 is the newest as of
September 2026). If one ever can, this folder and the `[patch]` go, and
`src-tauri/src/buffer.rs` calls that instead.

## What the patch does

Every change is marked `ventic:` in the source.

- **A stream window** — `ManagedTorrent::set_stream_window` in
  `torrent_state/streaming.rs`. Set, the torrent fetches `ahead` bytes past
  each open reader and nothing else: `acquire_next_piece` in
  `torrent_state/live/mod.rs` leaves the natural walk through the files out.
  Set back to 0, it is a download again.
- **Forgetting** — `TorrentStateLive::forget_outside`. A piece of a file being
  read that no reader is near has its have bit cleared
  (`ChunkTracker::forget_piece`), which queues it again so a reader that comes
  back for it gets it fetched, and on the next call its bytes go back to the
  filesystem through a new `TorrentStorage::discard`. The filesystem storage
  answers that with a punched hole (`storage/filesystem/sparse.rs`: `fallocate`
  on Linux and Android, `F_PUNCHHOLE` on macOS, `FSCTL_SET_ZERO_DATA` on
  Windows). The have bits are flushed at once, because fastresume trusts them
  and a hole reads back as zeros.
- **Waking requesters** — `TorrentStreams::moved`. A requester with nothing to
  fetch sleeps up to five seconds, and in a stream the next wanted piece only
  appears when a reader moves — so a reader now wakes them when it opens, seeks
  or reaches a new piece. Without it every seek past the buffer stalled.
- **Taking the piece under a reader off a slow peer** (`acquire_piece` in
  `piece_tracker.rs`). Peers take whole pieces from anywhere in the window, so
  the one a reader is blocked on can sit with a peer at a few KB/s, or one that
  has choked us, while everything after it arrives — and the stock steals only
  reach it at 10× the stealing peer's piece time. The first few missing pieces
  ahead of the readers are stolen at 2× instead. Measured on a TV after a seek:
  the three pieces under the reader landed 50 s late, behind 40 MB of pieces
  after them, and the player had given up at 36 s. Once per piece
  (`InflightPiece::rushed`): when the link slowed below what the peers'
  averages remembered, two fast peers took one 512 KB piece off each other for
  64 s, every steal starting it over.
- **Not disconnecting a peer that asks for a forgotten piece**
  (`on_download_request`). It was told we had the piece; it is behind the news,
  not misbehaving, and may be the peer the stream is fetching from.
- **`paused` on the HTTP add** (`http_api_types.rs`), which the library had and
  the API didn't pass through. A stream is added paused and started once its
  window is on; in between it would download the whole film at full speed.

`src-tauri/src/buffer.rs` is the only caller. Its `stream_window` test
(`cargo test --lib buffer`) runs all of the above end to end over loopback, a
seeder and a streaming leecher, in under a second.

## Moving to a newer librqbit

1. Copy the new version out of `~/.cargo/registry/src/*/librqbit-<version>` —
   bumping the version here with the `[patch]` commented out puts it there —
   over this folder. Keep this file; delete `webui/`, `Cargo.lock`,
   `Cargo.toml.orig` and `.cargo_vcs_info.json`.
2. From this folder, `patch -p1 < ../librqbit.patch`, and fix whatever doesn't
   apply by hand: the `ventic:` comments in the old copy say what each hunk is
   for. `Cargo.toml` is part of the patch twice over: the `libc` dependency, and
   every librqbit-* sibling pinned with `=` — the `[patch]` holds librqbit
   itself still, so a caret would let `cargo update` move those alone.
3. Bump the version in `src-tauri/Cargo.toml` and run `cargo test --lib buffer`.
4. Regenerate the patch, with the pristine copy as `a/` and this folder as `b/`:
   `diff -ruN -x VENTIC.md a b > ../librqbit.patch`.
