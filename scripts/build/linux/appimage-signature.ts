/**
 * Put the *shipped* AppImage's signature back into `latest.json`.
 *
 *   bun scripts/build/linux/appimage-signature.ts v0.2.0
 *
 * The Linux release build signs the AppImage the bundler produced and writes
 * that signature into `latest.json` — and then `appimage.ts` rewrites the file
 * to take libwayland back out, and the workflow re-uploads it. Everything is
 * now correct except the manifest, which still describes the artifact that no
 * longer exists: the updater downloads the new AppImage, checks it against the
 * old signature, and refuses to install with `signature verification failed`.
 * Nobody on Linux would ever get an update, and nothing about the release would
 * look wrong.
 *
 * So the workflow signs the AppImage *again* after the repack, hands that `.sig`
 * over as a workflow artifact, and this puts it in the manifest. The AppImage
 * itself is never fetched, and nothing lands on the release but the manifest —
 * `latest.json` carries every signature inline, which is the only copy the
 * updater reads, so a `.sig` asset beside each bundle would be pure clutter.
 *
 * It runs as its own job, after every platform's build. `latest.json` is
 * read-modify-written by all three of them in parallel, each merging its own
 * platforms into whatever is already on the release, so patching it from inside
 * the Linux job would race the other two and be silently overwritten by
 * whichever finished last.
 *
 * Everything here is skippable rather than fatal: with no signing key
 * configured there is no `latest.json` and no `.sig`, which is a release without
 * in-app updates, not a broken one.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/**
 * The two keys tauri-action writes for an AppImage: the bundle-specific one,
 * and the bare `linux-x86_64` it also becomes when it is the highest-priority
 * artifact of the build — which it always is, ahead of the .deb and .rpm.
 */
const APPIMAGE_KEY = 'linux-x86_64-appimage'
const PRIMARY_KEY = 'linux-x86_64'

interface Manifest {
  platforms?: Record<string, { signature?: string, url?: string }>
}

const [tag, sigPath] = process.argv.slice(2)
if (!tag || !sigPath) {
  console.error('Usage: bun scripts/build/linux/appimage-signature.ts <tag> <path/to/x.AppImage.sig>')
  process.exit(1)
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

// An unexpanded glob lands here as its own literal path when the artifact was
// never produced, which is the no-signing-key build.
if (!existsSync(sigPath))
  skip(`there is no ${sigPath}, so the AppImage was never signed`)

// Ask what the release holds before downloading anything, so "the release is a
// draft gh can't see" fails loudly here instead of arriving further down as a
// missing file and being mistaken for an unsigned build.
const assets = (JSON.parse(gh(['release', 'view', tag, '--json', 'assets'])) as {
  assets: { name: string }[]
}).assets.map(a => a.name)

if (!assets.includes('latest.json'))
  skip('the release carries none, so this build was not signed')

const dir = mkdtempSync(join(tmpdir(), 'ventic-updater-'))
// A few kilobytes. The AppImage it describes is never fetched.
gh(['release', 'download', tag, '--dir', dir, '--pattern', 'latest.json'])

const manifestPath = join(dir, 'latest.json')
const signature = readFileSync(sigPath, 'utf8').trim()
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
const platforms = manifest.platforms ?? {}

const appimage = platforms[APPIMAGE_KEY]
if (!appimage)
  skip(`it has no ${APPIMAGE_KEY} entry`)

if (appimage.signature === signature)
  skip('it already names the signature of the AppImage that shipped')

// `linux-x86_64` is the same artifact under its other name, but only while the
// AppImage is what the build ranked first — compare rather than assume, so a
// release that ever ships without one doesn't get the .deb's signature broken.
const alsoPrimary = platforms[PRIMARY_KEY]?.signature === appimage.signature

appimage.signature = signature
if (alsoPrimary)
  platforms[PRIMARY_KEY]!.signature = signature

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
gh(['release', 'upload', tag, manifestPath, '--clobber'])

console.log(
  `\n✓ latest.json now signs the repacked AppImage`
  + `${alsoPrimary ? ` (${APPIMAGE_KEY} and ${PRIMARY_KEY})` : ` (${APPIMAGE_KEY})`}\n`,
)
