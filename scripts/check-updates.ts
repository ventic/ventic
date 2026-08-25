// Self-check for the update notice: `bun scripts/check-updates.ts`.
//
// Two things worth holding still. The version compare decides whether people
// are told about a release at all — get it backwards and the app either nags
// for ever about a version it already runs, or never mentions one. And the
// GitHub release shape is somebody else's to change: a renamed field that
// quietly parsed to an empty version would turn the badge off with nothing
// anywhere to notice.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { APK_URL, compareVersions, DOWNLOAD_URL, isNewer, parseUpdate, RELEASES_URL } from '../app/utils/updates'

// --- Ordering ----------------------------------------------------------------

const older = (a: string, b: string) => assert.ok(compareVersions(a, b) < 0, `${a} < ${b}`)

older('0.1.1', '0.2.0')
older('0.9.0', '0.10.0') // the one a plain string compare gets wrong
older('1.0.0', '1.0.1')
older('0.1.0', '1.0.0')
assert.equal(compareVersions('0.2.0', '0.2.0'), 0)

// A tag carries the `v`; `getVersion()` never does. Both have to compare equal.
assert.equal(compareVersions('v0.2.0', '0.2.0'), 0)
// Build metadata is explicitly not part of the ordering.
assert.equal(compareVersions('0.2.0+abc', '0.2.0'), 0)
// Short forms count the missing parts as zero rather than as anything else.
assert.equal(compareVersions('1.2', '1.2.0'), 0)

// --- Prereleases -------------------------------------------------------------
// `releases/latest` never returns one, so this only matters on the side the
// *user* is running: someone on an rc has to be offered the real release.

older('0.2.0-rc.1', '0.2.0')
older('0.2.0-alpha', '0.2.0-beta')
older('0.2.0-rc.9', '0.2.0-rc.10') // numeric identifiers compare as numbers
older('0.2.0-rc', '0.2.0-rc.1') // fewer identifiers is the lower one
older('0.2.0-1', '0.2.0-alpha') // numeric sorts below alphanumeric
older('0.1.9', '0.2.0-rc.1')

// --- What actually gets offered ----------------------------------------------

assert.ok(isNewer('0.1.1', '0.2.0'))
assert.ok(!isNewer('0.2.0', '0.2.0'), 'the version you are running is not an update')
assert.ok(!isNewer('0.3.0', '0.2.0'), 'never offer a downgrade')
// No version means no Tauri — a browser dev session. Nothing to offer there.
assert.ok(!isNewer('', '0.2.0'))
assert.ok(!isNewer('0.1.1', ''))

// --- The GitHub payload ------------------------------------------------------

const release = {
  tag_name: 'v0.2.0',
  body: '  ## What changed\n- things\n  ',
  html_url: 'https://github.com/ventic/ventic/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'Ventic_0.2.0_amd64.AppImage', browser_download_url: 'https://example.invalid/appimage' },
    { name: 'Ventic_0.2.0.apk', browser_download_url: 'https://example.invalid/apk' },
  ],
}

const parsed = parseUpdate(release)
assert.equal(parsed?.version, '0.2.0', 'the tag\'s v is not part of the version')
assert.equal(parsed?.notes, '## What changed\n- things')
assert.equal(parsed?.url, release.html_url)
// Android needs the one file it can install, not the six the release carries.
assert.equal(parsed?.apk, 'https://example.invalid/apk')

// A release with no APK is a normal state, not a parse failure — the panel
// falls back to the release page.
assert.equal(parseUpdate({ ...release, assets: [] })?.apk, '')
assert.equal(parseUpdate({ ...release, html_url: undefined })?.url, RELEASES_URL)
assert.equal(parseUpdate({ ...release, body: undefined })?.notes, '')

// Neither should ever reach us from `/releases/latest`, and neither may be
// offered if one does.
assert.equal(parseUpdate({ ...release, draft: true }), null)
assert.equal(parseUpdate({ ...release, prerelease: true }), null)

// Anything without a version is not a release, however well-formed the rest is.
for (const bad of [null, undefined, {}, { tag_name: '' }, { tag_name: 'v' }, 'not json'])
  assert.equal(parseUpdate(bad), null, `rejected: ${JSON.stringify(bad)}`)

// --- Installing it on Android ------------------------------------------------
// No updater plugin exists there and no app can overwrite its own package, so
// the update is: download the APK, open the system installer on it. That path
// crosses from TS into Kotlin through the VenticScreen bridge, which no compiler
// checks — a method renamed on one side is an Update button that silently does
// nothing, on the one platform where there is no second way to install.

const kotlin = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/java/com/ventic/app/MainActivity.kt', import.meta.url),
  'utf8',
)
const platform = readFileSync(new URL('../app/utils/platform.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../app/stores/updates.ts', import.meta.url), 'utf8')
const manifest = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)

for (const method of ['installUpdate', 'updateProgress']) {
  assert.ok(kotlin.includes(`fun ${method}(`), `MainActivity answers ${method}()`)
  assert.ok(platform.includes(`${method}?.(`), `and platform.ts is what calls it`)
}

// Every state the poll can end on has to be one the store knows what to do with.
// A status Kotlin invents and the store doesn't handle reads as a failed
// download in front of a perfectly good file.
for (const state of ['downloading', 'installing', 'failed', 'idle']) {
  assert.ok(kotlin.includes(`"${state}"`), `Kotlin can report ${state}`)
  assert.ok(platform.includes(`'${state}'`), `and ApkInstall lists it`)
}
assert.ok(store.includes(`'installing'`), 'the store has Android\'s end state, which is not the desktop\'s')

// Without the permission the installer refuses to hear from us at all, and
// without the provider path FileProvider throws on the URI it is handed —
// both fail at the last step, after a 100 MB download.
assert.ok(
  manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'),
  'the manifest asks for REQUEST_INSTALL_PACKAGES',
)
assert.ok(
  readFileSync(
    new URL('../src-tauri/gen/android/app/src/main/res/xml/file_paths.xml', import.meta.url),
    'utf8',
  ).includes('external-files-path'),
  'and the FileProvider can lend out the folder the APK lands in',
)

// The bytes go to the package installer, and Android's own network config
// forbids cleartext besides — so a plain-http URL is a download that never
// starts, whichever end refuses it first.
for (const url of [APK_URL, DOWNLOAD_URL, RELEASES_URL])
  assert.ok(url.startsWith('https://'), `${url} is https`)
assert.ok(kotlin.includes('startsWith("https://")'), 'and Kotlin refuses anything else')

console.log('check-updates: ok')
