// Self-check for the release signatures: `bun scripts/check-signing.ts`.
//
// Two different signatures end up on one file and only one of them is checked
// by a machine the day it ships. SignPath embeds a certificate in the Windows
// installers *after* the bundler has already written a minisign signature for
// them into `latest.json` — so the installer on the release page is fine, the
// download works, SmartScreen is happy, and every existing install that tries
// to update itself gets `signature verification failed` instead. Nothing about
// that release looks wrong from here: the artifacts are all present and all
// correctly signed, it is the manifest that describes files that no longer
// exist. Exactly the AppImage repack's failure, which is why they share a fix.
//
// So the seam is an ordering across two jobs that no YAML schema enforces: sign
// → re-sign for the updater → hand the .sig to the `updater` job → patch the
// manifest there. Drop any link in that chain and the release still succeeds.
import assert from 'node:assert'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { entriesFor, signedFile } from './build/updater-signature'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const workflow = read('.github/workflows/release.yml')

// --- which entries a corrected bundle belongs to -----------------------------
//
// What tauri-action actually writes: one entry per bundle type, plus a bare
// `<os>-<arch>` alias for whichever it ranked highest — the same file under two
// names, and a signature fixed under only one of them is a release that updates
// nobody.
//
// It identifies those artifacts by GitHub API asset id, so the url cannot say
// which bundle an entry is for. The signature can: every one carries the file
// name in its minisign trusted comment. This is a real signature from the
// v0.7.3 release, kept verbatim so the parser is held against genuine output
// of `tauri signer sign` rather than against something written to suit it.

const REAL_NSIS_SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSYzRLcElvWWxHTmxPK1BKbjFVOERWK1JVM3pjdXh3OVlqbk5TdTJJRmVuZm90VTB6R1lheVc4WkJiSDJtc2ZDVitOamNBVVlKcEZ6VGlIMWVTYkVZL2diWGJkYml2emdrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwMDA3NzYzCWZpbGU6VmVudGljXzAuNy4zX3g2NC1zZXR1cC5leGUKak1hQkM1SHRaM085YWxoTjk1MjErL1oxdEJjcmNWSEtRV0JRWHdLZjh4MGRpUGVlcWdLZ1dmZzU3OWZQSHVEMU96ZkVkdWp3Qjc5OEhpYmM0NUF4Q0E9PQo='
const REAL_NSIS_URL = 'https://api.github.com/repos/ventic/ventic/releases/assets/579404469'

assert.equal(
  signedFile(REAL_NSIS_SIGNATURE),
  'Ventic_0.7.3_x64-setup.exe',
  'the file name is read out of a real tauri updater signature',
)
assert.equal(signedFile(undefined), null, 'an entry with no signature names no file')
assert.equal(signedFile('not base64 at all'), null, 'junk is an entry to skip, not a crash')

// The reason the url is not used, asserted rather than remembered.
assert.doesNotMatch(
  REAL_NSIS_URL,
  /Ventic_.*\.exe$/,
  'latest.json names artifacts by API asset id — matching a bundle by url finds nothing, silently',
)

/** A signature as `tauri signer sign` writes one, for the entries below. */
function sig(file: string, stamp = 1790007763) {
  return Buffer.from(
    `untrusted comment: signature from tauri secret key\nRUR${'x'.repeat(40)}\n`
    + `trusted comment: timestamp:${stamp}\tfile:${file}\n${'y'.repeat(40)}\n`,
  ).toString('base64')
}

const platforms = {
  'windows-x86_64': { signature: REAL_NSIS_SIGNATURE },
  'windows-x86_64-nsis': { signature: REAL_NSIS_SIGNATURE },
  'windows-x86_64-msi': { signature: sig('Ventic_0.7.3_x64_en-US.msi') },
  'linux-x86_64': { signature: sig('Ventic_0.7.3_amd64.AppImage', 1790007091) },
  'linux-x86_64-appimage': { signature: sig('Ventic_0.7.3_amd64.AppImage', 1790007091) },
  'linux-x86_64-deb': { signature: sig('Ventic_0.7.3_amd64.deb', 1790007075) },
  'darwin-aarch64': { signature: sig('Ventic.app.tar.gz', 1790008196) },
}

const keys = (bundle: string) => entriesFor(platforms, bundle).map(([k]) => k).sort()

assert.deepEqual(
  keys('Ventic_0.7.3_x64-setup.exe'),
  ['windows-x86_64', 'windows-x86_64-nsis'],
  'the NSIS installer is the bare windows-x86_64 as well as its own key',
)
assert.deepEqual(keys('Ventic_0.7.3_x64_en-US.msi'), ['windows-x86_64-msi'], 'the .msi is only ever itself')
assert.deepEqual(
  keys('Ventic_0.7.3_amd64.AppImage'),
  ['linux-x86_64', 'linux-x86_64-appimage'],
  'the AppImage is the bare linux-x86_64 as well as its own key',
)

// Nothing else moves: correcting Windows must not touch the .deb or the Mac.
assert.deepEqual(keys('setup.exe'), [], 'a name is matched whole, not as a suffix')
assert.deepEqual(keys('Ventic_0.7.4_x64-setup.exe'), [], 'a version that is not on the release matches nothing')

// --- the chain ---------------------------------------------------------------

const signpath = workflow.indexOf('signpath/github-action-submit-signing-request@')
assert.notEqual(signpath, -1, 'the release workflow no longer signs the Windows installers')

const resign = workflow.indexOf('bun run tauri signer sign')
assert.notEqual(resign, -1, 'nothing re-signs the SignPath-signed installers for the updater')
assert.ok(
  resign > signpath,
  'the installers are re-signed for the updater *before* SignPath rewrites them — '
  + 'the manifest would describe the bundle that was thrown away',
)

const script = 'scripts/build/updater-signature.ts'
assert.ok(workflow.includes(script), `the \`updater\` job no longer runs ${script}`)
assert.ok(
  workflow.indexOf(script) > resign,
  'the manifest is patched before the signatures it needs exist',
)
assert.doesNotMatch(
  workflow,
  /appimage-signature\.ts/,
  'appimage-signature.ts was generalised into updater-signature.ts — the old path signs nothing',
)

// The Linux half of the same chain, which predates it and is the reason it exists.
for (const glob of ['appimage-signature/*.AppImage.sig', 'windows-signatures/*.sig']) {
  assert.ok(
    workflow.includes(glob),
    `${script} is not given ${glob}, so that platform keeps the signature of a bundle it no longer ships`,
  )
}

// --- the artifacts those globs come out of -----------------------------------
//
// A typo in either name is silent twice over: download-artifact is
// `continue-on-error`, and the script treats an unexpanded glob as "this build
// had no signing key" and exits 0.

function named(action: string) {
  return [...workflow.matchAll(new RegExp(`actions/${action}-artifact@v\\d+[\\s\\S]{0,200}?name: (\\S+)`, 'g'))]
    .map(m => m[1]!)
}

const uploaded = new Set(named('upload'))
for (const name of named('download')) {
  assert.ok(
    uploaded.has(name),
    `the \`updater\` job downloads the artifact "${name}", which no job uploads under that name`,
  )
}

// --- what gets shipped to people ---------------------------------------------
//
// test-signing's certificate is trusted by no machine on earth: an installer
// carrying one is worse than an unsigned installer, because Windows reports a
// *broken* signature rather than a missing one. It is for rehearsing the
// pipeline on a draft that then gets deleted, and the repo variable is how —
// never the default committed here.
const policy = workflow.match(/signing-policy-slug: (.+)/)?.[1]?.trim()
assert.ok(policy, 'no signing-policy-slug in the release workflow')
assert.match(
  policy,
  /\|\|\s*'release-signing'\s*\}\}$/,
  `signing-policy-slug is \`${policy}\` — it must default to release-signing, with test-signing reachable only through the repo variable`,
)

console.log('✓ release signatures')
