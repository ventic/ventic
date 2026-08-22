#!/usr/bin/env bash
# Produce the three generated files a Flathub build needs, and optionally drop a
# complete submission into a flathub repo checkout.
#
#   TMDB_API=... ./generate-sources.sh v0.2.3 ~/src/flathub-ventic
#
# Flathub builds with no network, so every byte cargo and npm will read has to
# be declared as a source with a hash up front. That is what the two generators
# in flatpak-builder-tools do, and neither is packaged anywhere — hence the
# throwaway venv.
#
# The npm lockfile is generated here rather than committed: this repo is
# bun-only (package.json's preinstall enforces it), and a second lockfile in the
# tree is a second thing to keep in step. It exists purely because no SDK ships
# bun and flatpak-node-generator cannot read bun.lock.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
out=$here/generated
tag=${1:-}
flathub=${2:-}

[ -n "$tag" ] || { echo "usage: $0 <tag, e.g. v0.2.3> [path/to/flathub/repo]" >&2; exit 1; }
[ -n "${TMDB_API:-}" ] || { echo "TMDB_API is not set — the build would produce an app that cannot reach TMDB." >&2; exit 1; }

commit=$(git -C "$root" rev-parse "$tag^{commit}")
version=${tag#v}
echo "→ $tag ($commit)"

mkdir -p "$out"
cd "$out"

if [ ! -d flatpak-builder-tools ]; then
	git clone --depth 1 https://github.com/flatpak/flatpak-builder-tools
fi
[ -d .venv ] || python3 -m venv .venv
# Unguarded: pip is a no-op when these are already satisfied, and a guard on the
# venv alone means a changed dependency here never reaches an existing one.
# tomlkit rather than toml — that is what flatpak-cargo-generator.py imports.
./.venv/bin/pip install -q aiohttp tomlkit ./flatpak-builder-tools/node

# One entry per crate in the lock file, plus the config that points a --offline
# build at them. Read from the tag rather than the working tree: these hashes
# have to describe the bytes the Flathub builder will check out, and a dirty
# local checkout would produce a lockfile `cargo --offline` then rejects. Same
# for package.json below.
echo "→ cargo-sources.json"
git -C "$root" show "$tag:src-tauri/Cargo.lock" > Cargo.lock
./.venv/bin/python flatpak-builder-tools/cargo/flatpak-cargo-generator.py \
	Cargo.lock -o cargo-sources.json

# npm: --ignore-scripts so `preinstall` (only-allow bun) does not shoot this
# down. Resolution only — nothing is installed.
echo "→ package-lock.json"
rm -rf lockdir && mkdir lockdir
git -C "$root" show "$tag:package.json" > lockdir/package.json
(cd lockdir && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null)
mv lockdir/package-lock.json .
rm -rf lockdir

echo "→ node-sources.json"
./.venv/bin/flatpak-node-generator npm package-lock.json -o node-sources.json

# The manifest in git carries a placeholder so this repo never holds the token.
echo "→ manifest"
# Placeholders, not the `tag:`/`commit:` lines themselves — libplacebo's git
# source sits at the same indentation and was getting Ventic's revision.
sed -e "s|__TMDB_READ_TOKEN__|$TMDB_API|" \
    -e "s|__TAG__|$tag|" \
    -e "s|__COMMIT__|$commit|" \
    "$here/io.github.ventic.Ventic.yml" > io.github.ventic.Ventic.yml

# Keep the release list in the AppStream data in step with what is being built,
# or Flathub's own validation fails on a version it has never heard of.
sed -e "s|<release version=\"[^\"]*\" date=\"[^\"]*\"/>|<release version=\"$version\" date=\"$(git -C "$root" log -1 --format=%ad --date=short "$tag")\"/>|" \
    "$here/io.github.ventic.Ventic.metainfo.xml" > io.github.ventic.Ventic.metainfo.xml
appstreamcli validate --explain io.github.ventic.Ventic.metainfo.xml

cp "$here/io.github.ventic.Ventic.desktop" "$here/flathub.json" .

echo
echo "✓ $out"
ls -la io.github.ventic.Ventic.yml io.github.ventic.Ventic.metainfo.xml \
       io.github.ventic.Ventic.desktop flathub.json \
       cargo-sources.json node-sources.json package-lock.json

if [ -n "$flathub" ]; then
	cp io.github.ventic.Ventic.yml io.github.ventic.Ventic.metainfo.xml \
	   io.github.ventic.Ventic.desktop flathub.json \
	   cargo-sources.json node-sources.json package-lock.json "$flathub/"
	echo
	echo "✓ copied into $flathub — commit and push there."
fi

echo
echo "Build it before submitting anything:"
echo "  flatpak-builder --force-clean --user --install builddir $out/io.github.ventic.Ventic.yml"
echo "  flatpak run io.github.ventic.Ventic"
