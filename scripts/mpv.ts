/**
 * Put an mpv.exe where the Windows build can bundle it.
 *
 * On Linux the player runs whatever mpv the distro installed. Windows ships no
 * mpv and there is no package manager to lean on, so the app carries its own:
 * `tauri.windows.conf.json` declares `mpv/mpv.exe` as a resource, which puts it
 * next to Ventic.exe in the installer, and `player_windows.rs` resolves it from
 * there. This module is what makes that file exist.
 *
 * The binary is a community build (the same ones mpv.io points at) — mpv itself
 * publishes no Windows binaries. It is statically linked, so ffmpeg, libass and
 * the D3D11 output all come with it and nothing else has to be installed.
 *
 * Bumping it: pick a release from the repo below, then update all three fields
 * of `BUILD` — the tag, the asset name and the hash out of that release's
 * sha256.txt. The download is checked against it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** https://github.com/zhongfly/mpv-winbuild/releases */
const BUILD = {
  tag: '2026-07-26-b27573a239',
  asset: 'mpv-x86_64-20260726-git-b27573a239.7z',
  sha256: 'cee9077eb838c920ff1888e056cab79797539c97ed91e004bd1cf5a56afe19d5',
}

/** The one file we want out of the archive; the rest is docs and installers. */
const MEMBER = 'mpv.exe'

/** Where the bundler picks it up from — see tauri.windows.conf.json. */
const DEST_DIR = join(ROOT, 'src-tauri', 'mpv')
const DEST = join(DEST_DIR, MEMBER)

/** Kept out of src-tauri so a `cargo clean` doesn't cost another download. */
const CACHE = join(ROOT, '.cache', 'mpv')

/**
 * GPLv2, verbatim, as mpv ships it. Committed rather than fetched: a licence
 *  that only exists if a download succeeds is one a build can silently omit.
 */
const GPL = join(ROOT, 'scripts', 'mpv-LICENSE.GPL')
const LICENCE = join(DEST_DIR, 'LICENSE.txt')

/**
 * Handing out mpv.exe is redistributing GPL software, which obliges us to ship
 * the licence with it (§1) and to offer the source it was built from (§3). The
 * upstream archive carries neither — it is the exe, a manual and an updater —
 * so the notice is assembled here, and listed alongside mpv.exe in
 * tauri.windows.conf.json so the bundler puts the two side by side.
 *
 * The build tag ends in the mpv commit it was made from, which is what makes
 * "the corresponding source" a precise thing rather than a gesture.
 */
function notice() {
  const commit = BUILD.tag.split('-').pop()
  return `Ventic bundles mpv to play video on Windows.

mpv is free software licensed under the GNU General Public License, version 2
or later, reproduced in full below. Ventic's own code is MIT licensed and is a
separate work: it launches mpv as a child process and talks to it over an IPC
socket rather than linking against it.

The binary shipped beside this file is the community Windows build

    mpv-winbuild ${BUILD.tag}
    https://github.com/zhongfly/mpv-winbuild/releases/tag/${BUILD.tag}

built from mpv at commit ${commit} (https://github.com/mpv-player/mpv). It
statically links further free-software libraries — ffmpeg, libass, libplacebo
and others — each under its own terms; the build recipe at the URL above
enumerates them and is the corresponding source for the combined work.

WRITTEN OFFER
    For three years from the date you received this binary, the Ventic project
    will give any third party a complete machine-readable copy of the
    corresponding source code for the GPL-licensed parts of it, on a medium
    customarily used for software interchange, for no more than the cost of
    performing the distribution. Request one at
    https://github.com/ventic/desktop/issues.

----------------------------------------------------------------------------

`
}

/**
 * Every 7z reader worth trying, best first. Windows' own `tar` is bsdtar, which
 * reads 7z through libarchive; a Linux box more likely has p7zip. GNU tar comes
 * last because it cannot do this at all and only gets a turn when nothing else
 * exists.
 */
const EXTRACTORS: [string, (archive: string, dir: string) => string[]][] = [
  ['7z', (a, d) => ['x', '-y', `-o${d}`, a, MEMBER]],
  ['7za', (a, d) => ['x', '-y', `-o${d}`, a, MEMBER]],
  ['7zr', (a, d) => ['x', '-y', `-o${d}`, a, MEMBER]],
  ['bsdtar', (a, d) => ['-xf', a, '-C', d, MEMBER]],
  ['tar', (a, d) => ['-xf', a, '-C', d, MEMBER]],
]

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function download(url: string, to: string) {
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`${url} → HTTP ${res.status}`)
  writeFileSync(to, new Uint8Array(await res.arrayBuffer()))
}

/**
 * Ensure src-tauri/mpv/mpv.exe exists, downloading and unpacking it if not.
 * Returns the path. Throws with something actionable if it can't.
 */
export async function ensureMpv(): Promise<string> {
  mkdirSync(DEST_DIR, { recursive: true })
  // Rewritten every run, not just on download: a cached exe from an older tag
  // would otherwise keep a notice pointing at the wrong source.
  writeFileSync(LICENCE, notice() + readFileSync(GPL, 'utf8'))

  if (existsSync(DEST))
    return DEST

  mkdirSync(CACHE, { recursive: true })
  const archive = join(CACHE, BUILD.asset)

  if (!existsSync(archive)) {
    const url = `https://github.com/zhongfly/mpv-winbuild/releases/download/${BUILD.tag}/${BUILD.asset}`
    console.log(`→ Fetching mpv for Windows (${BUILD.asset}, ~32 MB)`)
    await download(url, archive)
  }

  // A truncated or tampered download would otherwise surface as a mystery
  // "mpv exited unexpectedly" in the player weeks later.
  const got = sha256(archive)
  if (got !== BUILD.sha256) {
    rmSync(archive, { force: true })
    throw new Error(
      `mpv download does not match its checksum.\n`
      + `  expected ${BUILD.sha256}\n`
      + `  got      ${got}\n`
      + `  The file has been deleted; run the build again to retry.`,
    )
  }

  for (const [cmd, args] of EXTRACTORS) {
    const r = spawnSync(cmd, args(archive, DEST_DIR), { stdio: 'ignore' })
    if (r.status === 0 && existsSync(DEST)) {
      console.log(`✓ Unpacked mpv.exe with ${cmd}\n`)
      return DEST
    }
  }

  throw new Error(
    `Could not unpack ${archive}.\n`
    + `  It needs a 7z reader: p7zip (\`7z\`) or bsdtar.\n`
    + `  Arch: sudo pacman -S p7zip · Debian: sudo apt install p7zip-full`,
  )
}

/** mpv's own version string, for the build log. */
export function mpvVersion(exe: string): string {
  try {
    return execFileSync(exe, ['--version'], { encoding: 'utf8' }).split('\n')[0]?.trim() ?? ''
  }
  catch {
    return '' // not runnable here, which is normal when cross-compiling
  }
}

// Also usable on its own: `bun scripts/mpv.ts`
if (import.meta.main) {
  ensureMpv()
    .then(path => console.log(path))
    .catch((e: Error) => {
      console.error(`\n✗ ${e.message}\n`)
      process.exit(1)
    })
}
