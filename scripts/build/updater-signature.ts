/**
 * Put the signatures of the bundles that *shipped* back into `latest.json`.
 *
 *   bun scripts/build/updater-signature.ts v0.2.0 path/to/bundle.sig ...
 *
 * Two platforms hand the updater a file the bundler never saw. Linux repacks the
 * AppImage to take libwayland back out (linux/appimage.ts), and Windows sends
 * the installers to SignPath, which returns them with a certificate embedded.
 * Both rewrite bytes the bundler had already signed, so everything about the
 * release ends up correct except the manifest: it still describes the artifact
 * that no longer exists, and the updater downloads the new file, checks it
 * against the old signature, and refuses to install with `signature
 * verification failed`. Nobody on that platform would ever get an update, and
 * nothing about the release would look wrong.
 *
 * So whoever rewrites a bundle signs it again and hands the `.sig` over as a
 * workflow artifact, and this puts those signatures in the manifest. The bundles
 * themselves are never fetched, and nothing lands on the release but the
 * manifest — `latest.json` carries every signature inline, which is the only
 * copy the updater reads, so a `.sig` asset beside each bundle would be pure
 * clutter.
 *
 * Entries are found by the file each one already signs — not by platform key,
 * and not by url. A bundle is usually in the manifest twice, under its own key
 * (`linux-x86_64-appimage`, `windows-x86_64-nsis`) and under the bare
 * `linux-x86_64`/`windows-x86_64` it also becomes as the build's
 * highest-priority artifact, so both have to be corrected; hard-coding which
 * keys those are would rot the day tauri-action ranks a build differently. The
 * url cannot answer it: tauri-action writes GitHub's API asset id there
 * (`.../releases/assets/579404469`) and never a file name. The signature
 * already in the entry can — `tauri signer sign` puts `file:<name>` in every
 * minisign trusted comment it writes, so each entry says which bundle it is
 * for, and the ones naming the file we replaced are exactly the ones to fix.
 *
 * It runs as its own job, after every platform's build. `latest.json` is
 * read-modify-written by every desktop runner, each merging its own platforms
 * into whatever is already on the release, so patching it from inside the Linux
 * or Windows job would be overwritten by whichever finished last.
 *
 * Everything here is skippable rather than fatal: with no signing key configured
 * there is no `latest.json` and no `.sig`, which is a release without in-app
 * updates, not a broken one.
 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

export interface Platform { signature?: string, url?: string }

interface Manifest {
  platforms?: Record<string, Platform>
}

/**
 * The bundle a signature was made for, out of minisign's trusted comment:
 *
 *   trusted comment: timestamp:1790007763\tfile:Ventic_0.7.3_x64-setup.exe
 *
 * That comment is covered by the signature, so it is not something a corrupt
 * manifest can lie about into a wrong correction — a tampered one simply stops
 * matching. Anything unreadable is not an error here, just an entry this run
 * has nothing to say about.
 */
export function signedFile(signature: string | undefined): string | null {
  if (!signature)
    return null
  const text = Buffer.from(signature, 'base64').toString('utf8')
  return text.match(/^trusted comment:.*\bfile:(.+)$/m)?.[1]?.trim() ?? null
}

/** Every entry that signs `bundle` — its own key, and the bare alias beside it. */
export function entriesFor(platforms: Record<string, Platform>, bundle: string) {
  return Object.entries(platforms).filter(([, p]) => signedFile(p.signature) === bundle)
}

function gh(args: string[]) {
  const r = spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (r.status !== 0) {
    console.error(`\n✗ gh ${args.join(' ')} failed\n`)
    process.exit(1)
  }
  return r.stdout ?? ''
}

/** Nothing to do, and that is a legitimate outcome — say why and stop. */
function skip(why: string): never {
  console.log(`→ Leaving latest.json alone: ${why}`)
  process.exit(0)
}

if (import.meta.main) {
  const [tag, ...sigs] = process.argv.slice(2)
  if (!tag || !sigs.length) {
    console.error('Usage: bun scripts/build/updater-signature.ts <tag> <path/to/bundle.sig>...')
    process.exit(1)
  }

  // An unexpanded glob lands here as its own literal path when the artifact was
  // never produced, which is the no-signing-key build.
  const present = sigs.filter(existsSync)
  if (!present.length)
    skip('none of those signatures exist, so no bundle was rewritten after signing')

  // Ask what the release holds before downloading anything, so "the release is a
  // draft gh can't see" fails loudly here instead of arriving further down as a
  // missing file and being mistaken for an unsigned build.
  const assets = (JSON.parse(gh(['release', 'view', tag, '--json', 'assets'])) as {
    assets: { name: string }[]
  }).assets.map(a => a.name)

  if (!assets.includes('latest.json'))
    skip('the release carries none, so this build was not signed')

  const dir = mkdtempSync(join(tmpdir(), 'ventic-updater-'))
  // A few kilobytes. The bundles it describes are never fetched.
  gh(['release', 'download', tag, '--dir', dir, '--pattern', 'latest.json'])

  const manifestPath = join(dir, 'latest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  const platforms = manifest.platforms ?? {}
  const corrected: string[] = []

  for (const sig of present) {
    // `Ventic_0.7.3_x64-setup.exe.sig` is the signature of the asset beside it.
    const bundle = basename(sig).replace(/\.sig$/, '')
    const signature = readFileSync(sig, 'utf8').trim()
    const entries = entriesFor(platforms, bundle)

    if (!entries.length) {
      console.log(`→ No entry in latest.json points at ${bundle}`)
      continue
    }

    for (const [key, platform] of entries) {
      if (platform.signature === signature)
        continue
      platform.signature = signature
      corrected.push(key)
    }
  }

  if (!corrected.length)
    skip('every entry already names the signature of the bundle that shipped')

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  gh(['release', 'upload', tag, manifestPath, '--clobber'])

  console.log(`\n✓ latest.json now signs the bundles that shipped (${corrected.join(', ')})\n`)
}
