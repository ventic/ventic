/**
 * Make the macOS .app stand on its own.
 *
 * The player links libmpv rather than launching mpv (see src/player_macos.rs),
 * so the binary leaves the linker pointing at Homebrew's
 * /opt/homebrew/lib/libmpv.2.dylib — and libmpv points at forty-odd more
 * (ffmpeg, libass, harfbuzz, …). Every one of those resolves on the machine
 * that built it and none of them resolve anywhere else: the app dies before
 * main() with a dyld error naming a path the user has never heard of.
 *
 * dylibbundler walks that tree, copies each non-system dylib into src-tauri/
 * dylibs and rewrites every load command to @executable_path.
 * tauri.macos.conf.json carries that directory into Contents/Resources.
 *
 *   bun scripts/macdylibs.ts          → collect and rewrite (beforeBundleCommand)
 *   bun scripts/macdylibs.ts <app>    → verify a bundled .app resolves
 *
 * It runs as `beforeBundleCommand` because that is the one moment when the
 * binary exists and the .app does not yet — the bundler then copies an already
 * self-contained binary in, which means this works the same under `bun run
 * build` and under tauri-action in CI.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** Kept in step with the resources glob in src-tauri/tauri.macos.conf.json. */
const STAGING = 'src-tauri/dylibs'
const INSTALL_PATH = '@executable_path/../Resources/dylibs/'

/** Homebrew (either prefix) and MacPorts. /usr/lib and /System are macOS itself. */
const FOREIGN = /^\/(?:opt\/homebrew|usr\/local|opt\/local)\//

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function have(cmd: string) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
}

function dylibs(dir: string) {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.dylib')).map(f => join(dir, f)) : []
}

/** What a Mach-O asks the loader for, minus otool's header line. */
function deps(file: string): string[] {
  return execFileSync('otool', ['-L', file], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map(l => l.trim().split(' ')[0] ?? '')
    .filter(Boolean)
}

/**
 * Tauri runs before-commands from the project root and describes the build in
 * the environment, so `--target` and `--debug` are covered without parsing argv.
 */
function binary(): string {
  const profile = process.env.TAURI_ENV_DEBUG === 'true' ? 'debug' : 'release'
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE
  const paths = [
    ...(triple ? [`src-tauri/target/${triple}/${profile}/ventic`] : []),
    `src-tauri/target/${profile}/ventic`,
  ]
  return paths.find(existsSync) ?? die(`No built binary at ${paths.join(' or ')}.`)
}

function bundle() {
  if (!have('dylibbundler')) {
    die(
      'dylibbundler is missing — it is what makes the .app run on a Mac without\n'
      + '  Homebrew, by copying libmpv and everything under it into the bundle.\n'
      + '    brew install dylibbundler',
    )
  }

  const bin = binary()
  // From scratch: a dylib left behind by an older brew would otherwise ship
  // alongside the one actually linked, and only one of them is loaded.
  rmSync(STAGING, { recursive: true, force: true })
  mkdirSync(STAGING, { recursive: true })

  execFileSync(
    'dylibbundler',
    ['-of', '-cd', '-b', '-x', bin, '-d', STAGING, '-p', INSTALL_PATH],
    { stdio: 'inherit' },
  )

  // mpv is GPL and now travels inside the bundle, the same as the mpv.exe the
  // Windows build carries.
  copyFileSync('scripts/mpv-LICENSE.GPL', join(STAGING, 'LICENSE-mpv.txt'))

  // install_name_tool invalidates a Mach-O's signature, and Apple Silicon kills
  // a process whose signature is *broken* rather than ignoring it — SIGKILL with
  // nothing in the log worth reading. This ad-hoc signature is what lets the app
  // start at all; it is not distribution signing and does nothing for Gatekeeper.
  for (const f of [bin, ...dylibs(STAGING)])
    execFileSync('codesign', ['--force', '--sign', '-', f])

  console.log(`\n✓ ${dylibs(STAGING).length} dylibs staged for Contents/Resources/dylibs\n`)
}

/**
 * Does the finished .app resolve without Homebrew? Cheaper than owning a second
 * Mac to find out on, and the failure it catches — a resource landing somewhere
 * other than where the rewritten load commands point — is invisible on the
 * machine that built it, where the original /opt/homebrew paths still exist.
 */
function check(app: string) {
  const macos = join(app, 'Contents/MacOS')
  const exe = readdirSync(macos).map(f => join(macos, f))[0] ?? die(`${macos} has no executable.`)
  const staged = dylibs(join(app, 'Contents/Resources/dylibs'))
  if (!staged.length)
    die(`${app} carries no dylibs — the bundler put the resources somewhere other than\n  Contents/Resources/dylibs, which is where the binary looks for them.`)

  const bad: string[] = []
  for (const file of [exe, ...staged]) {
    for (const dep of deps(file)) {
      if (FOREIGN.test(dep))
        bad.push(`${file}\n    still links ${dep}`)
      else if (dep.startsWith('@executable_path/') && !existsSync(join(macos, dep.slice('@executable_path/'.length))))
        bad.push(`${file}\n    points at ${dep}, which is not in the bundle`)
      else if (dep.startsWith('@rpath/'))
        bad.push(`${file}\n    kept an unresolved ${dep}`)
    }
  }

  if (bad.length)
    die(`The .app will not run without Homebrew:\n\n  ${bad.join('\n  ')}`)
  console.log(`\n✓ ${app} resolves all ${staged.length} bundled dylibs from inside itself\n`)
}

// Runs as a build hook on every platform; only macOS has anything to do.
if (process.platform === 'darwin') {
  const [app] = process.argv.slice(2)
  if (app)
    check(app)
  else
    bundle()
}
