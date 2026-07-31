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
 * So walk that tree, copy each non-system dylib into src-tauri/dylibs and
 * rewrite every load command to @executable_path. tauri.macos.conf.json carries
 * that directory into Contents/Resources.
 *
 *   bun scripts/build/macos/bundle-dylib.ts          → collect and rewrite (beforeBundleCommand)
 *   bun scripts/build/macos/bundle-dylib.ts <app>    → verify a bundled .app resolves
 *
 * It runs as `beforeBundleCommand` because that is the one moment when the
 * binary exists and the .app does not yet — the bundler then copies an already
 * self-contained binary in, which means this works the same under `bun run
 * build` and under tauri-action in CI.
 *
 * The staging directory itself is build.rs's, not this script's: tauri_build
 * resolves the `dylibs/*` glob during the compile and fails if it matches
 * nothing, which is long before anything here has run. So it creates the
 * directory and leaves mpv's licence in it, and this script only ever adds and
 * removes dylibs — never the directory.
 *
 * Only otool, install_name_tool and codesign are used, all of which come with
 * the Xcode command line tools the build already needs.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

/** Kept in step with the resources glob in src-tauri/tauri.macos.conf.json. */
const STAGING = 'src-tauri/dylibs'
const INSTALL_DIR = '@executable_path/../Resources/dylibs'

/** Anything under these is macOS itself, served from the dyld shared cache. */
const SYSTEM = ['/usr/lib/', '/System/', '/Library/Apple/']

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function tool(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 })
}

function staged(dir: string) {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.dylib')).map(f => join(dir, f)) : []
}

/** LC_ID_DYLIB, or null for an executable. */
function installId(file: string): string | null {
  const lines = tool('otool', ['-D', file]).trim().split('\n')
  return lines.length > 1 ? lines[1]!.trim() : null
}

/** LC_RPATH entries, in the order dyld searches them. */
function rpaths(file: string): string[] {
  const lines = tool('otool', ['-l', file]).split('\n')
  return lines.flatMap((line, i) => {
    if (!line.includes('cmd LC_RPATH'))
      return []
    const path = lines.slice(i + 1, i + 4).map(l => l.match(/^\s*path (.+?) \(offset \d+\)\s*$/)?.[1]).find(Boolean)
    return path ? [path] : []
  })
}

/**
 * What a Mach-O asks the loader for, exactly as written in its load commands —
 * minus otool's header line, and minus the file's own install name, which it
 * lists first and does not depend on.
 */
function deps(file: string): string[] {
  const id = installId(file)
  return tool('otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map(l => l.trim().replace(/ \(compatibility version .*$/, ''))
    .filter(l => l.length > 0 && l !== id)
}

/** Turn @rpath/@loader_path/@executable_path into a path on this disk. */
function locate(dep: string, referrer: string, exe: string): string | null {
  const expand = (p: string) => p
    .replace(/^@loader_path/, dirname(referrer))
    .replace(/^@executable_path/, dirname(exe))

  if (dep.startsWith('@rpath/')) {
    const tail = dep.slice('@rpath/'.length)
    return rpaths(referrer).map(rp => resolve(expand(rp), tail)).find(existsSync) ?? null
  }
  return existsSync(expand(dep)) ? expand(dep) : null
}

interface Node {
  /** Symlink-resolved source path; libmpv.2.dylib and libmpv.dylib are one file. */
  src: string
  /** How this binary names each dependency, and what it should name it instead. */
  edges: { from: string, to: string }[]
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

/** Every non-system Mach-O reachable from the executable, breadth-first. */
function graph(exe: string): Map<string, Node> {
  const nodes = new Map<string, Node>()
  const queue = [exe]

  while (queue.length) {
    const current = queue.shift()!
    if (nodes.has(current))
      continue

    const node: Node = { src: current, edges: [] }
    nodes.set(current, node)

    for (const dep of deps(current)) {
      if (SYSTEM.some(p => dep.startsWith(p)))
        continue
      const found = locate(dep, current, exe)
      if (!found)
        die(`${current}\n  asks for ${dep}, which is nowhere on this machine.`)
      const real = realpathSync(found)
      node.edges.push({ from: dep, to: basename(real) })
      queue.push(real)
    }
  }
  return nodes
}

function bundle() {
  const exe = binary()
  const nodes = graph(exe)
  const libs = [...nodes.values()].filter(n => n.src !== exe)

  // The staging directory is flat, so two libraries with one basename would
  // overwrite each other and only one of them would ever be loaded.
  const seen = new Map<string, string>()
  for (const lib of libs) {
    const clash = seen.get(basename(lib.src))
    if (clash)
      die(`Two different libraries are both named ${basename(lib.src)}:\n  ${clash}\n  ${lib.src}`)
    seen.set(basename(lib.src), lib.src)
  }

  // From scratch: a dylib left behind by an older brew would otherwise ship
  // alongside the one actually linked, and only one of them is loaded. The
  // directory and the licence in it are build.rs's — take only the dylibs.
  for (const old of staged(STAGING))
    rmSync(old)

  for (const lib of libs) {
    const dest = join(STAGING, basename(lib.src))
    copyFileSync(lib.src, dest)
    chmodSync(dest, 0o755) // Cellar keeps its copies read-only, install_name_tool writes in place
  }

  for (const node of nodes.values()) {
    const target = node.src === exe ? exe : join(STAGING, basename(node.src))
    const args = node.src === exe ? [] : ['-id', `${INSTALL_DIR}/${basename(node.src)}`]
    for (const edge of node.edges)
      args.push('-change', edge.from, `${INSTALL_DIR}/${edge.to}`)
    if (args.length)
      tool('install_name_tool', [...args, target])
  }

  // install_name_tool invalidates a Mach-O's signature, and Apple Silicon kills
  // a process whose signature is *broken* rather than ignoring it — SIGKILL with
  // nothing in the log worth reading. This ad-hoc signature is what lets the app
  // start at all; it is not distribution signing and does nothing for Gatekeeper.
  for (const f of [exe, ...staged(STAGING)])
    tool('codesign', ['--force', '--sign', '-', f])

  console.log(`\n✓ ${libs.length} dylibs staged for Contents/Resources/dylibs\n`)
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
  const libs = staged(join(app, 'Contents/Resources/dylibs'))
  if (!libs.length)
    die(`${app} carries no dylibs — the bundler put the resources somewhere other than\n  Contents/Resources/dylibs, which is where the binary looks for them.`)

  const bad: string[] = []
  for (const file of [exe, ...libs]) {
    for (const dep of deps(file)) {
      if (dep.startsWith('@executable_path/')) {
        if (!existsSync(join(macos, dep.slice('@executable_path/'.length))))
          bad.push(`${file}\n    points at ${dep}, which is not in the bundle`)
      }
      else if (dep.startsWith('@rpath/') || dep.startsWith('@loader_path/')) {
        bad.push(`${file}\n    kept an unresolved ${dep}`)
      }
      else if (!SYSTEM.some(p => dep.startsWith(p))) {
        bad.push(`${file}\n    still links ${dep}`)
      }
    }
  }

  if (bad.length)
    die(`The .app will not run without Homebrew:\n\n  ${bad.join('\n  ')}`)
  console.log(`\n✓ ${app} resolves all ${libs.length} bundled dylibs from inside itself\n`)
}

// Runs as a build hook on every platform; only macOS has anything to do.
if (process.platform === 'darwin') {
  const [app] = process.argv.slice(2)
  if (app)
    check(app)
  else
    bundle()
}
