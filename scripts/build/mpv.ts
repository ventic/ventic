/**
 * Put an mpv.exe and an ffmpeg.exe where the Windows build can bundle them.
 *
 * On Linux the player runs whatever mpv and ffmpeg the distro installed.
 * Windows ships neither and has no package manager to lean on, so the app
 * carries its own: `tauri.windows.conf.json` declares them as resources, which
 * puts them next to Ventic.exe in the installer, and `player_windows.rs` and
 * `lib.rs` resolve them from there. This module is what makes those files exist.
 *
 * They are community builds (the same ones mpv.io points at) — mpv itself
 * publishes no Windows binaries. Both are statically linked, so libass and the
 * D3D11 output come with them and nothing else has to be installed.
 *
 * mpv already contains ffmpeg, but as libraries and with no command line, and
 * the seek previews and the subtitle auto-sync are two processes shelling out
 * to `ffmpeg`. Bundling the CLI is ~105 MB unpacked and is what makes both of
 * them work on a machine that has never heard of ffmpeg — which on Windows is
 * every machine.
 *
 * Bumping them: pick a release from the repo below, then update `BUILD.tag` and
 * each binary's asset name and hash out of that release's sha256.txt. Every
 * download is checked against it.
 *
 * The pin is not load-bearing, because upstream deletes a release after about a
 * month: when it is gone `resolve()` takes the newest build instead, so a
 * release cut long after the last bump still produces an installer.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * https://github.com/zhongfly/mpv-winbuild/releases
 *
 * One release, two binaries, one `sha256.txt`. ffmpeg comes from the same place
 * as mpv because it is the same build of the same libraries — bumping them
 * together is what stops the player and the tools that read what it is playing
 * from drifting apart.
 */
const BUILD = {
  tag: '2026-08-26-c318236b88',
  binaries: [
    {
      member: 'mpv.exe',
      asset: 'mpv-x86_64-20260826-git-c318236b88.7z',
      sha256: '1ccee88f10d4049906f339b6718c87bec7e94c6ec86652d4de70082959da7b27',
      // How to find the same binary in a release this file has never seen (see
      // `resolve()`). Anchored, because every release also holds -dev, -debug,
      // -lgpl and AVX2-only (-v3) variants of the same name.
      match: /^mpv-x86_64-\d+-git-[0-9a-f]+\.7z$/,
    },
    /**
     * mpv links ffmpeg statically but exposes no CLI, and the seek previews and
     * the subtitle auto-sync both shell out to one — so without this they are
     * features that only work if the user happened to install ffmpeg himself,
     * which on Windows nobody has.
     */
    {
      member: 'ffmpeg.exe',
      asset: 'ffmpeg-x86_64-git-a1050d48b.7z',
      sha256: 'c67b9b4a36a2d823eefb7e33b65031778ccd90ab3fccc88a77390dbb76c4add5',
      match: /^ffmpeg-x86_64-git-[0-9a-f]+\.7z$/,
    },
  ],
}

type Release = typeof BUILD

const RELEASES = 'https://github.com/zhongfly/mpv-winbuild/releases'

function assetUrl(tag: string, asset: string) {
  return `${RELEASES}/download/${tag}/${asset}`
}

/** Where the bundler picks them up from — see tauri.windows.conf.json. */
const DEST_DIR = join(ROOT, 'src-tauri', 'mpv')

/** Kept out of src-tauri so a `cargo clean` doesn't cost another download. */
const CACHE = join(ROOT, '.cache', 'mpv')

/**
 * GPLv2, verbatim, as mpv ships it. Committed rather than fetched: a licence
 *  that only exists if a download succeeds is one a build can silently omit.
 */
const GPL = join(ROOT, 'scripts', 'build', 'mpv-LICENSE.GPL')
const LICENCE = join(DEST_DIR, 'LICENSE.txt')

/**
 * Handing out mpv.exe and ffmpeg.exe is redistributing GPL software, which
 * obliges us to ship the licence with them (§1) and to offer the source they
 * were built from (§3). The upstream archives carry neither — they are the exe
 * and nothing else — so the notice is assembled here, and listed alongside them
 * in tauri.windows.conf.json so the bundler puts the three side by side.
 *
 * The build tag ends in the mpv commit it was made from, which is what makes
 * "the corresponding source" a precise thing rather than a gesture.
 */
function notice(release: Release) {
  const commit = release.tag.split('-').pop()
  return `Ventic bundles mpv to play video on Windows, and ffmpeg to read the
audio and the frames of what it is playing.

Both are free software licensed under the GNU General Public License, version 2
or later, reproduced in full below. Ventic's own code is MIT licensed and is a
separate work: it launches each of them as a child process and talks to them
over an IPC socket or a pipe rather than linking against either.

The binaries shipped beside this file are the community Windows builds

${release.binaries.map(b => `    ${b.asset}`).join('\n')}
    ${RELEASES}/tag/${release.tag}

built from mpv at commit ${commit} (https://github.com/mpv-player/mpv) and from
ffmpeg (https://github.com/FFmpeg/FFmpeg) at the commit its own file name ends
with. They statically link further free-software libraries — libass, libplacebo
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
const EXTRACTORS: [string, (archive: string, dir: string, member: string) => string[]][] = [
  ['7z', (a, d, m) => ['x', '-y', `-o${d}`, a, m]],
  ['7za', (a, d, m) => ['x', '-y', `-o${d}`, a, m]],
  ['7zr', (a, d, m) => ['x', '-y', `-o${d}`, a, m]],
  ['bsdtar', (a, d, m) => ['-xf', a, '-C', d, m]],
  ['tar', (a, d, m) => ['-xf', a, '-C', d, m]],
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
 * The release to take the binaries from: the pinned one, or the newest build if
 * it has been deleted. zhongfly keeps about a month of releases, so a pin always
 * outlives itself — and a 404 here failed the whole Windows job before anything
 * had been compiled.
 */
async function resolve(): Promise<Release> {
  const pinned = await fetch(assetUrl(BUILD.tag, BUILD.binaries[0]!.asset), { method: 'HEAD' })
  if (pinned.ok)
    return BUILD

  const res = await fetch('https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest')
  if (!res.ok)
    throw new Error(`mpv build ${BUILD.tag} is gone and the newest one could not be looked up → HTTP ${res.status}`)
  const tag = (await res.json() as { tag_name: string }).tag_name

  // That release's own sha256.txt is the only checksum there can be for a build
  // nobody here has pinned, and still catches a truncated or swapped download.
  const url = assetUrl(tag, 'sha256.txt')
  const sums = await fetch(url)
  if (!sums.ok)
    throw new Error(`${url} → HTTP ${sums.status}`)
  const lines = (await sums.text()).trim().split('\n').map(l => l.trim().split(/\s+/))

  const binaries = BUILD.binaries.map(binary => {
    const found = lines.find(([, asset]) => asset && binary.match.test(asset))
    if (!found)
      throw new Error(`release ${tag} holds nothing matching ${binary.match} for ${binary.member}`)
    return { ...binary, asset: found[1]!, sha256: found[0]! }
  })

  console.log(`! mpv build ${BUILD.tag} no longer exists upstream — using ${tag}.`)
  console.log(`  Bump BUILD in scripts/build/mpv.ts to the one you have tested.`)
  return { tag, binaries }
}

/** One binary out of the release, downloaded, checked and unpacked. */
async function ensure(binary: Release['binaries'][number], tag: string): Promise<string> {
  const dest = join(DEST_DIR, binary.member)
  if (existsSync(dest))
    return dest

  mkdirSync(CACHE, { recursive: true })
  const archive = join(CACHE, binary.asset)

  if (!existsSync(archive)) {
    const url = assetUrl(tag, binary.asset)
    console.log(`→ Fetching ${binary.member} for Windows (${binary.asset}, ~30 MB)`)
    await download(url, archive)
  }

  // A truncated or tampered download would otherwise surface as a mystery
  // "mpv exited unexpectedly" in the player weeks later.
  const got = sha256(archive)
  if (got !== binary.sha256) {
    rmSync(archive, { force: true })
    throw new Error(
      `${binary.member} download does not match its checksum.\n`
      + `  expected ${binary.sha256}\n`
      + `  got      ${got}\n`
      + `  The file has been deleted; run the build again to retry.`,
    )
  }

  for (const [cmd, args] of EXTRACTORS) {
    const r = spawnSync(cmd, args(archive, DEST_DIR, binary.member), { stdio: 'ignore' })
    if (r.status === 0 && existsSync(dest)) {
      console.log(`✓ Unpacked ${binary.member} with ${cmd}`)
      return dest
    }
  }

  throw new Error(
    `Could not unpack ${archive}.\n`
    + `  It needs a 7z reader: p7zip (\`7z\`) or bsdtar.\n`
    + `  Arch: sudo pacman -S p7zip · Debian: sudo apt install p7zip-full`,
  )
}

/**
 * Ensure src-tauri/mpv/ holds every binary the Windows bundle declares as a
 * resource, downloading and unpacking what is missing. Returns mpv's path, which
 * is the one the build log names. Throws with something actionable if it can't.
 */
export async function ensureMpv(): Promise<string> {
  mkdirSync(DEST_DIR, { recursive: true })

  // Only when there is something to fetch: a build with both binaries already
  // unpacked must not need the network, and the pin can only be checked over it.
  const release = BUILD.binaries.every(b => existsSync(join(DEST_DIR, b.member)))
    ? BUILD
    : await resolve()

  // Rewritten every run, not just on download: a cached exe from an older tag
  // would otherwise keep a notice pointing at the wrong source.
  writeFileSync(LICENCE, notice(release) + readFileSync(GPL, 'utf8'))

  const paths: string[] = []
  for (const binary of release.binaries)
    paths.push(await ensure(binary, release.tag))
  return paths[0]!
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

// Also usable on its own: `bun scripts/build/mpv.ts`
if (import.meta.main) {
  ensureMpv()
    .then(path => console.log(path))
    .catch((e: Error) => {
      console.error(`\n✗ ${e.message}\n`)
      process.exit(1)
    })
}
