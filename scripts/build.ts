/**
 * Produce an installable build of the app.
 *
 *   bun run build              → whatever the machine you're on can make natively
 *   bun run build windows      → a Windows .exe, cross-compiled from Linux
 *   bun run build android      → an APK for phones / Android TV boxes
 *   bun run build android-dev  → run on an attached device, hot-reloading
 *
 * Everything here is a preflight check plus a `tauri` invocation. The checks
 * exist because the failures they catch otherwise surface hundreds of lines
 * deep in a Gradle, cargo or linker trace.
 *
 * What does and doesn't cross-compile, measured rather than assumed:
 *   - The Windows .exe builds fine from Linux through cargo-xwin.
 *   - Its NSIS installer additionally needs a native `makensis`.
 *   - A .msi does not cross-compile at all; the tauri CLI refuses the bundle
 *     type off Windows, because WiX is Windows-only tooling.
 *   - macOS needs a Mac: the SDK and codesigning aren't redistributable.
 *
 * Windows builds also carry their own mpv.exe, which scripts/mpv.ts fetches
 * before the bundler runs.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { ensureMpv, mpvVersion } from './mpv'

const HOST_BUNDLES: Record<string, string> = {
  linux: '.deb, .rpm and .AppImage',
  win32: '.exe (NSIS) and .msi',
  darwin: '.app and .dmg',
}

const WIN_TARGET = 'x86_64-pc-windows-msvc'

/**
 * rustup lives in ~/.cargo/bin, which is deliberately not on the shell PATH
 * here so it doesn't shadow the distro's rust for everyday work. The cross
 * builds are the one place that needs it, so put it in front for those only.
 */
function crossPath(): Record<string, string> {
  const bin = join(homedir(), '.cargo', 'bin')
  return existsSync(bin) ? { PATH: `${bin}:${process.env.PATH ?? ''}` } : {}
}

/** Does the command exist and answer `--version`? */
function have(cmd: string) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore', env: { ...process.env, ...crossPath() } }).status === 0
}

/** Does the command merely exist? Some tools have no `--version` (makensis). */
function exists(cmd: string) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/**
 * Android's Gradle plugin rejects JDKs newer than it knows about. Check the JDK
 * Gradle will actually use — JAVA_HOME wins over PATH, which is how you keep a
 * newer system default (Arch ships one) without it reaching the build.
 */
function javaMajor(): number | null {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
  const out = spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr ?? ''
  const m = out.match(/version "(\d+)/)
  return m ? Number(m[1]) : null
}

/**
 * Tauri looks for the NDK at NDK_HOME. The SDK manager installs it under
 * $ANDROID_HOME/ndk/<version>, so pick the newest one up rather than making
 * everyone export a second variable.
 */
function resolveNdk(sdk: string): string | null {
  for (const v of [process.env.NDK_HOME, process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT]) {
    if (v && existsSync(v))
      return v
  }
  const dir = join(sdk, 'ndk')
  if (!existsSync(dir))
    return null
  const versions = readdirSync(dir).sort()
  return versions.length ? join(dir, versions.at(-1)!) : null
}

function checkRustTargets(needed: string[]) {
  if (!have('rustup')) {
    die(
      'Cross-compiling needs rustup-managed toolchains, and rustup is not installed.\n'
      + '  A distro-packaged rust (pacman, apt) only ships the host target.\n'
      + '  Install it with: curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    )
  }
  const installed = execFileSync('rustup', ['target', 'list', '--installed'], {
    encoding: 'utf8',
    env: { ...process.env, ...crossPath() },
  })
  const missing = needed.filter(t => !installed.includes(t))
  if (missing.length)
    die(`Missing Rust targets. Run:\n  rustup target add ${missing.join(' ')}`)
}

async function buildDesktop(extra: string[]) {
  const bundles = HOST_BUNDLES[process.platform]
  if (!bundles)
    die(`No idea what to bundle on ${process.platform}.`)

  if (process.platform === 'linux' && spawnSync('pkg-config', ['--exists', 'webkit2gtk-4.1']).status !== 0) {
    die(
      'WebKitGTK development files are missing — Tauri cannot link without them.\n'
      + '  Arch:   sudo pacman -S webkit2gtk-4.1 libappindicator-gtk3 librsvg\n'
      + '  Debian: sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev',
    )
  }

  if (process.platform === 'win32')
    await bundleMpv()

  console.log(`\n→ Building for ${process.platform}: ${bundles}\n`)
  // The AppImage step shells out to linuxdeploy, which carries its own ancient
  // `strip`. On a distro new enough to emit `.relr.dyn` relocation sections it
  // fails on every system library it copies in and takes the bundle down with
  // it. Skipping the strip costs a few MB and nothing else.
  run(['tauri', 'build', ...extra], process.platform === 'linux' ? { NO_STRIP: '1' } : {})
  console.log('\n✓ Bundles are in src-tauri/target/release/bundle/\n')

  if (process.platform === 'darwin') {
    console.log(
      'Note: playback needs the native mpv backend, which macOS does not have yet.\n'
      + 'This build browses, downloads and seeds; pressing play reports that.\n',
    )
  }
  else if (process.platform === 'linux' && !have('mpv')) {
    console.log('Note: mpv is not on PATH, so the built app will not be able to play anything.\n')
  }
}

/**
 * Windows carries its own mpv (nothing on the machine provides one), so make
 * sure the resource the bundler is about to look for is actually there.
 */
async function bundleMpv() {
  try {
    const exe = await ensureMpv()
    const version = mpvVersion(exe)
    console.log(`✓ Bundling ${version || exe}\n`)
  }
  catch (e) {
    die(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Windows, cross-compiled. cargo-xwin supplies the MSVC headers and import
 * libraries and lld-link does the linking, so the whole tree — tauri, wry,
 * webview2-com, librqbit — builds here without a Windows machine.
 *
 * The installer is the part that doesn't fully carry over: NSIS needs a native
 * makensis, and .msi is off the table entirely. The bare .exe carries the
 * frontend but not mpv, which is a resource beside it — so hand over the folder
 * or the installer, not the .exe on its own.
 */
async function buildWindows(extra: string[]) {
  if (process.platform === 'win32')
    return buildDesktop(extra)

  checkRustTargets([WIN_TARGET])
  if (!have('cargo-xwin'))
    die('cargo-xwin is missing — it provides the MSVC toolchain.\n  Install it: cargo install cargo-xwin --locked')

  await bundleMpv()

  // Without makensis the bundler dies *after* a full release compile, so decide
  // up front and just skip the installer step instead of wasting the build.
  const nsis = exists('makensis')
  const bundle = nsis ? ['--bundles', 'nsis'] : ['--no-bundle']

  console.log(`\n→ Cross-compiling for Windows (${WIN_TARGET})${nsis ? ' + NSIS installer' : ', binary only'}\n`)
  run(['tauri', 'build', '--runner', 'cargo-xwin', '--target', WIN_TARGET, ...bundle, ...extra], crossPath())

  const out = `src-tauri/target/${WIN_TARGET}/release/`
  console.log(`\n✓ ${out}ventic.exe — copy it over together with the mpv/ folder beside it.\n`)
  if (nsis)
    console.log(`✓ ${out}bundle/nsis/ — the installer, named for the version in tauri.conf.json\n`)
  else
    console.log('For a real installer, install NSIS (Arch: yay -S nsis) and run this again.\n')

  console.log(
    'The .exe needs the WebView2 runtime, which ships with Windows 11 and with any\n'
    + 'updated Windows 10. A .msi cannot be produced off Windows at all — the tauri\n'
    + 'CLI rejects the bundle type, because WiX only runs there. Run `bun run build`\n'
    + 'on the Windows machine itself if you need one.\n',
  )
}

/**
 * Everything `tauri android` needs before it will get anywhere, and the NDK
 * path it expects in the environment. Shared by the APK build and `dev`.
 */
function androidEnv(): Record<string, string> {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (!sdk || !existsSync(sdk)) {
    die(
      'ANDROID_HOME is not set (or points nowhere).\n'
      + '  Install "Android SDK Command-line Tools" + "NDK" via Android Studio, or unpack\n'
      + '  the commandlinetools zip, then:\n'
      + '    export ANDROID_HOME="$HOME/Android/Sdk"\n'
      + '    sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;29.0.14206865"',
    )
  }

  const ndk = resolveNdk(sdk)
  if (!ndk)
    die(`No NDK found under ${join(sdk, 'ndk')}.\n  Install one: sdkmanager "ndk;29.0.14206865"`)

  const java = javaMajor()
  if (java !== null && (java < 17 || java > 21)) {
    die(
      `Gradle's Android plugin needs JDK 17–21, and the JDK it would use is ${java}.\n`
      + '  Point JAVA_HOME at a supported one, e.g.\n'
      + '    export JAVA_HOME=/usr/lib/jvm/java-21-openjdk',
    )
  }

  // aarch64 covers every TV box and modern phone; x86_64 covers the emulator.
  // The 32-bit ABIs only matter for hardware old enough not to be worth testing.
  checkRustTargets(['aarch64-linux-android', 'x86_64-linux-android'])
  return { NDK_HOME: ndk }
}

const ANDROID_ABIS = ['aarch64', 'x86_64']

function buildAndroid(extra: string[]) {
  // The APK is a debug build only so it comes out signed; it does not also need
  // to carry a debugger's worth of DWARF. That is ~90% of the file — each ABI's
  // .so goes from ~346 MB to ~38 MB — for symbols nothing on the device reads.
  // The symbol *table* stays (that would be `strip=symbols`), so a panic in
  // logcat still names functions, just without file:line. Set here rather than
  // in Cargo.toml so `tauri:dev` on the desktop keeps its full backtraces; with
  // `--target` in play cargo won't apply it to host build scripts.
  const env = { ...androidEnv(), RUSTFLAGS: '-Cstrip=debuginfo' }

  // Release APKs come out unsigned and Android refuses to install those. A debug
  // build is signed with the standard debug key, so it installs anywhere with no
  // keystore to set up. Rust dependencies are still optimised (see the
  // profile.dev.package override in Cargo.toml), so streaming keeps up.
  console.log(`\n→ Building a debug-signed APK for ${ANDROID_ABIS.join(' + ')}\n`)
  run(['tauri', 'android', 'build', '--debug', '--apk', '--target', ...ANDROID_ABIS, ...extra], env)

  const out = 'src-tauri/gen/android/app/build/outputs/apk/universal/debug/'
  console.log(
    `\n✓ APK written under ${out}\n\n`
    + 'Install it:\n'
    + `  adb install -r ${out}app-universal-debug.apk\n\n`
    + 'For a TV box, enable Developer options → USB/Network debugging, then\n'
    + '  adb connect <tv-ip>:5555\n\n'
    + 'Playback there is the webview\'s <video>, not mpv, so codec support is the\n'
    + 'device\'s — see "Playback and codecs" in the README.\n',
  )
}

/**
 * The phone as a second dev target: same hot-reloading frontend as
 * `bun run tauri:dev`, running on the device over `adb`.
 *
 * Only the architecture of whatever is plugged in gets built — compiling both
 * doubles a cold Rust build for a binary that is thrown away on every reload.
 */
/**
 * Nuxt quietly moves to 3001 if 3000 is taken, but the devUrl baked into the
 * app and the `adb reverse` below are both fixed at 3000 — so the phone loads
 * a blank page and nothing says why. Fail here, where the cause is still on
 * screen.
 *
 * Binds 127.0.0.1, which also catches a 0.0.0.0 squatter; a process
 * bound to *only* the LAN address would slip through.
 */
function portFree(port: number) {
  return new Promise<boolean>(resolve => {
    const s = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(port, '127.0.0.1')
  })
}

async function devAndroid(extra: string[]) {
  const env = androidEnv()

  if (!await portFree(3000)) {
    die(
      'Port 3000 is already in use, and the dev build needs it.\n'
      + '  The app is built pointing at :3000, so Nuxt falling back to :3001 leaves\n'
      + '  the device showing a blank page.\n'
      + '  Find the squatter with: ss -ltnp sport = :3000',
    )
  }

  const devices = spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout ?? ''
  const attached = devices.split('\n').slice(1).filter(l => /\tdevice$/.test(l.trim()))
  if (!attached.length) {
    die(
      'adb sees no device.\n'
      + '  Phone: enable Developer options → USB debugging, plug it in, and accept the\n'
      + '         "Allow USB debugging?" prompt on the phone itself (`adb devices` shows\n'
      + '         "unauthorized" until you do).\n'
      + '  TV box: Developer options → Network debugging, then `adb connect <tv-ip>:5555`.',
    )
  }
  console.log(`\n→ ${attached.length} device(s) attached; starting the dev build\n`)

  // A device on the other side of adb cannot reach the dev server on the
  // laptop's localhost. `adb reverse` makes :3000 on the phone come out of this
  // machine — both the frontend the webview loads and the HMR socket
  // nuxt.config aims back here, which rides the same port.
  for (const line of attached) {
    const serial = line.trim().split(/\s+/)[0]!
    spawnSync('adb', ['-s', serial, 'reverse', 'tcp:3000', 'tcp:3000'], { stdio: 'inherit' })
  }

  // Left to itself the CLI points the device at the laptop's LAN address, which
  // ignores the reverse above and instead needs the device on the same network
  // *and* the firewall to allow 3000 inbound — ufw denies that by default. The
  // failure is opaque when it happens, because the thing that can't connect is
  // the app's own dev-server proxy: the webview reports ERR_CONNECTION_REFUSED
  // against http://tauri.localhost, naming neither the address nor the port it
  // actually failed to reach. Loopback over adb has none of those moving parts
  // and works over USB with the wifi off.
  run(['tauri', 'android', 'dev', '--host', '127.0.0.1', ...extra], env)
}

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bun', ['run', ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (r.status !== 0)
    process.exit(r.status ?? 1)
}

const [target = 'desktop', ...extra] = process.argv.slice(2)

if ((target === 'macos' || target === 'mac') && process.platform !== 'darwin') {
  die(
    'A macOS build has to run on a Mac. Unlike Windows, there is no redistributable\n'
    + '  SDK to cross-compile against, and the .app has to be codesigned locally.\n'
    + '  Clone the repo there and run: bun install && bun run build',
  )
}

if (target === 'desktop' || target === 'macos' || target === 'mac')
  await buildDesktop(extra)
else if (target === 'windows')
  await buildWindows(extra)
else if (target === 'android')
  buildAndroid(extra)
else if (target === 'android-dev')
  await devAndroid(extra)
else
  die(`Unknown target "${target}". Use: desktop | windows | android | android-dev`)
