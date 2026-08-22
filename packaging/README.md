# Packaging

Two distribution channels live here, both free. Neither needs a certificate:
Linux package managers verify by hash and by who pushed the commit, so nothing
in this directory costs money.

| | Who reviews it | How long | What you have to keep doing |
|---|---|---|---|
| [AUR](#aur) | Nobody | Minutes | Nothing — CI pushes each release |
| [Flathub](#flathub) | A human, once | Days to a few weeks | Regenerate sources per release, open a PR |

---

## AUR

`ventic-bin` repackages the `.deb` from the GitHub release. It does not build
from source: that would compile the whole Rust tree *and* run a Nuxt build on
every user's machine for bytes that already exist.

It also deliberately does not repackage the AppImage. The AppImage runtime sets
`$APPIMAGE`, and that variable is what tells `can_self_update` in
`src-tauri/src/lib.rs` that this copy may overwrite its own binary — which under
a package manager is a file `pacman` owns. Unpacked from the `.deb` there is no
bundle type, so the app defers to `pacman` and the update panel says so.

### One-time setup

1. **Make an AUR account** at <https://aur.archlinux.org/register>. Email and a
   username; there is no review and no fee.
2. **Upload an SSH public key** under *My Account → SSH Public Key*. Make a
   dedicated one rather than reusing your GitHub key:
   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/aur -C "aur@ventic" -N ""
   cat ~/.ssh/aur.pub     # paste this into the AUR account page
   ```
3. **Create the package** by pushing it once by hand. The AUR has no "new
   package" button — a push to a repo that does not exist creates it, and the
   name you push claims the name:
   ```sh
   GIT_SSH_COMMAND="ssh -i ~/.ssh/aur" git clone ssh://aur@aur.archlinux.org/ventic-bin.git
   cp packaging/aur/PKGBUILD packaging/aur/.SRCINFO ventic-bin/
   cd ventic-bin
   git add PKGBUILD .SRCINFO
   git commit -m "Initial import"
   GIT_SSH_COMMAND="ssh -i ~/.ssh/aur" git push -u origin master
   ```
   It is live the moment that push lands.
4. **Add two repository secrets** on GitHub so releases publish themselves:
   - `AUR_SSH_KEY` — the contents of `~/.ssh/aur` (the private half)
   - `AUR_USERNAME` — your AUR account name

From then on `.github/workflows/aur.yml` runs whenever a release is
**published** (not when the tag is pushed — release.yml leaves a draft, and a
draft's asset URLs 404). It rewrites `pkgver` and both hashes from the actual
release assets, regenerates `.SRCINFO` in a throwaway Arch container, and
pushes.

### Testing a change

```sh
cd packaging/aur
makepkg -f --nodeps        # builds; drop --nodeps to check the dependency list
makepkg --printsrcinfo > .SRCINFO
namcap ./*.pkg.tar.zst     # optional; flags packaging mistakes
```

---

## Flathub

Flathub builds from source on its own machines, **with no network access**, so
every crate and every npm package has to be declared up front with a hash. That
is what `generate-sources.sh` produces.

The app id is `io.github.ventic.Ventic`, not the `com.ventic.app` that Tauri
uses internally. Flathub requires an id under a domain the publisher
demonstrably controls, and `github.com/ventic` qualifies with no paperwork. The
Tauri identifier is deliberately left alone — it names the config and data
directories, so changing it would strand every existing install's settings.

### One-time setup

1. **A GitHub account is all you need.** Flathub logs in with it; there is no
   separate registration and no fee.
2. **Build it locally first.** Nothing else in this repo can tell you whether
   the manifest works, and a submission that fails to build is a wasted review
   slot:
   ```sh
   sudo pacman -S flatpak flatpak-builder          # or apt/dnf install
   flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
   flatpak install --user flathub org.gnome.Platform//50 org.gnome.Sdk//50 \
       org.freedesktop.Sdk.Extension.node22//25.08 org.freedesktop.Sdk.Extension.rust-stable//25.08

   TMDB_API=<the read token> ./packaging/flatpak/generate-sources.sh v0.2.2
   flatpak-builder --force-clean --user --install builddir \
       packaging/flatpak/generated/io.github.ventic.Ventic.yml
   flatpak run io.github.ventic.Ventic
   ```
   Expect the first build to take a while — it compiles ffmpeg, mpv and the
   whole Rust tree.
3. **Submit.** Fork <https://github.com/flathub/flathub>, make a branch **named
   exactly `io.github.ventic.Ventic`** off `new-pr` (not off `master` — the bot
   rejects that), put the seven generated files at the repo root, and open a PR
   against the `new-pr` branch.

   A bot builds it and comments. A human then reviews; expect questions, and
   expect to answer these two in particular:
   - **`--socket=x11` rather than `fallback-x11` + `wayland`.** The player
     parents a real mpv process into a child of the app's own window by X11
     window id (`src-tauri/src/player.rs`, which sets `GDK_BACKEND=x11` before
     GTK starts for exactly that reason). A Wayland surface has no id to hand
     mpv, so there is nothing to fall back *to*.
   - **`--filesystem=home`.** Downloads go wherever *Settings → Storage*
     points, and the torrent engine writes there with an ordinary path — it is
     never a file the document portal sees, so a portal grant would not reach
     it. This is the same grant other BitTorrent clients on Flathub hold.

   Being a BitTorrent client is not itself a problem — several are already
   published. Ventic ships with **no sources configured** and indexes nothing,
   which is worth saying in the PR description.

4. Once merged you get push access to a `flathub/io.github.ventic.Ventic` repo.
   Add a **`FLATHUB_TOKEN`** repository secret here — a PAT with push access to
   that repo — and releases publish themselves from then on.

### Per release

Nothing, once `FLATHUB_TOKEN` is set. `.github/workflows/flathub.yml` runs when
a release is **published**, regenerates the sources for that tag and pushes them
to the Flathub repo; their CI builds whatever lands on master. Without the
secret it prints a notice and does nothing, so it is harmless before the
submission is merged.

By hand, if you ever need to:

```sh
TMDB_API=<token> ./packaging/flatpak/generate-sources.sh v0.2.3 ~/src/flathub-ventic
cd ~/src/flathub-ventic && git commit -am "Update to 0.2.3" && git push
```

The one thing that is *not* automatic is the app's own version: the manifest
deliberately carries no `is-main-source`, so Flathub's update bot never bumps
the tag on its own. It would open a PR pinning a new tag against the previous
release's vendored cargo and npm sources, which cannot build offline. The bot
still updates ffmpeg, mpv, libplacebo and libXpresent, which it can do
correctly.

`generated/` is gitignored: the two source manifests are megabytes of hashes
that belong in the flathub repo, and the generated manifest has the TMDB token
substituted into it.

### Known rough edges

- **`x86_64` only** to start with, via `flathub.json`. aarch64 would build the
  same way, but it doubles the surface for a first submission to fail on.
  Delete the `only-arches` line once x86_64 is green.
- **The npm lockfile is generated, not committed.** This repo is bun-only, no
  SDK ships bun, and `flatpak-node-generator` cannot read `bun.lock`. One
  consequence: npm ignores the `resolutions` field in `package.json`, so the
  Flatpak build gets real `typescript` where a local build gets `tslite`.
  Nothing is type-checked during `nuxt generate`, so this affects build time
  and nothing else.
- **The in-app updater is off here for free.** `bundle_type()` returns nothing
  inside a Flatpak, so `can_self_update` is false and the update panel points
  at the release page — which is what Flathub requires anyway.
