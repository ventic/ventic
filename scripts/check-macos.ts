// Self-check for the macOS deployment floor: `bun scripts/check-macos.ts`.
//
// The .app carries Homebrew's libmpv and the forty-odd dylibs behind it, and a
// bottle records the macOS that *built* it as the oldest it will load on. So the
// CI runner image is the real system requirement, and nothing about the build
// says so: the build machine is always new enough, `otool` on it resolves fine,
// and the failure lands on somebody else's Mac as a SIGKILL before main().
//
// That is 0.5.1: `macos-latest` moved to macOS 26 in July 2026, and the release
// shipped dylibs dyld refused on macOS 15 while the Info.plist claimed 10.13.
//
// Two numbers have to agree and no compiler compares them — the runner pinned in
// the release workflow, and bundle.macOS.minimumSystemVersion, which is what the
// bundle promises in LSMinimumSystemVersion. Compare them here, where it takes
// no Mac to notice, and hold the otool parsing that enforces it at bundle time.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { minos, newer, version } from './build/macos/bundle-dylib'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// --- ordering ---------------------------------------------------------------

assert.ok(newer(version('26.0'), version('15.7.2')), 'a major bump is newer')
assert.ok(newer(version('15.7.2'), version('15.7')), 'a longer version is newer than its own prefix')
assert.ok(!newer(version('15.0'), version('15.0')), 'equal is not newer — a dylib built for the floor is fine')
assert.ok(!newer(version('10.13'), version('15.0')), 'older is not newer')
assert.ok(!newer(version('15'), version('15.0')), '15 and 15.0 are the same macOS')

// --- what otool actually prints ---------------------------------------------

const TAHOE = `
Load command 8
      cmd LC_ID_DYLIB
  cmdsize 48
     name /opt/homebrew/opt/libplacebo/lib/libplacebo.349.dylib
   current version 349.0.0
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 26.0
      sdk 26.0
   ntools 1
`
assert.deepEqual(minos(TAHOE), [26, 0], 'reads LC_BUILD_VERSION and not the dylib version beside it')

// A fat file lists one load command per slice; the app runs only where every
// slice it might pick would load, so the highest is the floor.
assert.deepEqual(minos(`    minos 11.0\n      sdk 26.0\n    minos 26.0\n`), [26, 0], 'a fat file floors at its newest slice')

// Pre-10.14 Mach-Os carry LC_VERSION_MIN_MACOSX instead, whose field is `version`.
// Nothing to enforce there — it is below every floor worth checking.
assert.equal(minos(`      cmd LC_VERSION_MIN_MACOSX\n  version 10.13\n      sdk 10.13\n`), null, 'no LC_BUILD_VERSION is not a failure')

// --- the seam: the runner is the requirement ---------------------------------

const promised = JSON.parse(read('src-tauri/tauri.conf.json')).bundle?.macOS?.minimumSystemVersion
assert.ok(promised, 'bundle.macOS.minimumSystemVersion must be set — tauri defaults it to 10.13, which the bundled dylibs cannot honour')

const workflow = read('.github/workflows/release.yml')
assert.doesNotMatch(
  workflow,
  /^\s*- os: macos-latest\s*$/m,
  'the macOS runner must be pinned: `macos-latest` moves, and it takes the app\'s system requirement with it',
)

const pinned = workflow.match(/^\s*- os: macos-(\d+)\s*$/m)?.[1]
assert.ok(pinned, 'no `- os: macos-<version>` in the release workflow')
assert.equal(
  pinned,
  String(version(promised)[0]),
  `the release workflow builds on macOS ${pinned} but the bundle promises macOS ${promised} — `
  + 'Homebrew bottles inherit the runner, so the higher of the two is what users actually need',
)

console.log('✓ macOS deployment floor')
