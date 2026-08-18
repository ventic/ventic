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
 * Windows builds also carry their own mpv.exe, which scripts/build/mpv.ts fetches
 * before the bundler runs.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
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
  // `delimiter`, not ':' — Windows splits PATH on ';', so a colon here glues our
  // entry onto the front of the next one and loses both.
  return existsSync(bin) ? { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` } : {}
}

/** Does the command exist and answer `--version`? */
function have(cmd: string) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore', env: { ...process.env, ...crossPath() } }).status === 0
}

/** Does the command merely exist? Some tools have no `--version` (makensis). */
function exists(cmd: string) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
}

/**
 * Is there a libmpv for the macOS player to link against? The same directories
 * `src-tauri/build.rs` hands the linker, since neither Homebrew's nor MacPorts'
 * is on its default search path.
 */
function haveLibmpv() {
  return ['/opt/homebrew/lib', '/usr/local/lib', '/opt/local/lib']
    .some(dir => ['libmpv.dylib', 'libmpv.2.dylib'].some(lib => existsSync(join(dir, lib))))
}

/**
 * What to hand `tauri build` about update signatures.
 *
 * `bundle.createUpdaterArtifacts` is on, and the bundler treats a configured
 * `pubkey` with no private key as an error — thrown at the very end, after the
 * whole release compile. That is fine in CI, where the key is a secret, and
 * wrong everywhere else: someone who cloned this to build it for themselves has
 * no key and no reason to want one.
 *
 * So: the environment wins, then the key `tauri signer generate -w` writes by
 * convention, and failing both the artifacts are simply turned off for that
 * build. The bundles are byte-for-byte the same either way — all that is missing
 * is the .sig beside them, which only a release needs.
 */
function updaterSigning(): { env: Record<string, string>, args: string[] } {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY)
    return { env: {}, args: [] }

  const key = join(homedir(), '.tauri', 'ventic.key')
  if (existsSync(key)) {
    console.log(`✓ Signing updates with ${key}\n`)
    return {
      // The key's *contents*, which is what CI passes too. `tauri build` reads
      // only this one variable — the `_PATH` form the signer subcommand takes is
      // not consulted here, and setting it just gets you the "public key has
      // been found, but no private key" error at the end of a whole build.
      env: {
        TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8').trim(),
        // Explicitly empty rather than absent: an unset password makes the CLI
        // stop and prompt for one, which hangs a build nobody is watching.
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
      },
      args: [],
    }
  }

  console.log(
    'Note: no updater signing key, so these bundles carry no update signature and\n'
    + '      the in-app updater will not accept them. Fine for a build you are going to\n'
    + '      run yourself; for a release, see .github/workflows/release.yml.\n',
  )
  return { env: {}, args: ['--config', '{"bundle":{"createUpdaterArtifacts":false}}'] }
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/** The same "set this variable" advice, in the shell the reader is actually in. */
function setEnvHint(name: string, value: string) {
  return process.platform === 'win32'
    ? `[Environment]::SetEnvironmentVariable("${name}", "${value}", "User")`
    : `export ${name}="${value}"`
}

/**
 * Android's Gradle plugin rejects JDKs newer than it knows about. Check the JDK
 * Gradle will actually use — JAVA_HOME wins over PATH, which is how you keep a
 * newer system default (Arch ships one) without it reaching the build.
 */
function javaMajor(): number | null {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
  const out = spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr ?? ''
  // 9 and up report `version "21.0.12"`; 8 and below report `version "1.8.0_131"`,
  // where the major version is the *second* number. Without that branch an
  // ancient JRE reports itself as 1 and the error names a version nobody has.
  const m = out.match(/version "(\d+)(?:\.(\d+))?/)
  if (!m)
    return null
  return m[1] === '1' ? Number(m[2] ?? 1) : Number(m[1])
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

  if (process.platform === 'darwin' && !haveLibmpv()) {
    die(
      'libmpv is missing, and the macOS player links it rather than launching mpv\n'
      + '  (see src-tauri/src/player_macos.rs). Without it the build ends in\n'
      + '  "ld: library \'mpv\' not found", hundreds of lines down.\n'
      + '    brew install mpv',
    )
  }

  // The .app carries that libmpv rather than expecting it on the target Mac —
  // scripts/build/macos/bundle-dylib.ts, run by beforeBundleCommand, which rewrites
  // Mach-O load commands with the Xcode command line tools. Check for them here
  // rather than after a full release compile.
  if (process.platform === 'darwin' && !['otool', 'install_name_tool', 'codesign'].every(exists)) {
    die(
      'The Xcode command line tools are missing — otool and install_name_tool are\n'
      + '  what put libmpv and the ffmpeg tree behind it inside the .app, so it runs\n'
      + '  on a Mac without Homebrew.\n'
      + '    xcode-select --install',
    )
  }

  if (process.platform === 'win32')
    await bundleMpv()

  const signing = updaterSigning()

  console.log(`\n→ Building for ${process.platform}: ${bundles}\n`)
  // The AppImage step shells out to linuxdeploy, which carries its own ancient
  // `strip`. On a distro new enough to emit `.relr.dyn` relocation sections it
  // fails on every system library it copies in and takes the bundle down with
  // it. Skipping the strip costs a few MB and nothing else.
  run(
    ['tauri', 'build', ...signing.args, ...extra],
    { ...signing.env, ...(process.platform === 'linux' ? { NO_STRIP: '1' } : {}) },
  )

  // The AppImage ships the build machine's libwayland and can't be left that
  // way — see the script. CI does the same thing as its own workflow step,
  // because tauri-action never runs this file.
  // With the signing env, because the repack invalidates the signature the
  // bundler just made and the script signs it again (see there).
  if (process.platform === 'linux')
    run(['scripts/build/linux/appimage.ts'], signing.env)

  console.log('\n✓ Bundles are in src-tauri/target/release/bundle/\n')

  // Whether the .app is actually self-contained is invisible here, where the
  // Homebrew paths it was built against still exist — so ask before shipping it.
  if (process.platform === 'darwin') {
    const i = extra.indexOf('--target')
    const dir = join('src-tauri/target', i === -1 ? '' : extra[i + 1]!, 'release/bundle/macos')
    const app = existsSync(dir) ? readdirSync(dir).find(f => f.endsWith('.app')) : undefined
    if (app)
      run(['scripts/build/macos/bundle-dylib.ts', join(dir, app)])
  }

  if (process.platform === 'linux' && !have('mpv')) {
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

  const signing = updaterSigning()

  console.log(`\n→ Cross-compiling for Windows (${WIN_TARGET})${nsis ? ' + NSIS installer' : ', binary only'}\n`)
  run(
    ['tauri', 'build', '--runner', 'cargo-xwin', '--target', WIN_TARGET, ...bundle, ...signing.args, ...extra],
    { ...crossPath(), ...signing.env },
  )

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
    const guess = process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'Android', 'Sdk')
      : join(homedir(), 'Android', 'Sdk')
    die(
      'ANDROID_HOME is not set (or points nowhere).\n'
      + '  Install "Android SDK Command-line Tools" + "NDK" via Android Studio, or unpack\n'
      + '  the commandlinetools zip, then:\n'
      + `    ${setEnvHint('ANDROID_HOME', guess)}\n`
      + '    sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;29.0.14206865"',
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
      + `    ${setEnvHint('JAVA_HOME', process.platform === 'win32'
        ? 'C:\\Program Files\\Eclipse Adoptium\\jdk-21'
        : '/usr/lib/jvm/java-21-openjdk')}`,
    )
  }

  // aarch64 covers modern phones and TV boxes; x86_64 covers the emulator.
  // armv7 is not optional despite the CPUs being 64-bit: a lot of TVs (Philips
  // and the other MediaTek sets) ship a 32-bit userspace, so `ro.product.cpu.
  // abilist` is armeabi-v7a only and an APK without it fails to install with
  // nothing but "app isn't compatible with your device" on screen.
  checkRustTargets(['aarch64-linux-android', 'armv7-linux-androideabi', 'x86_64-linux-android'])
  return { NDK_HOME: ndk }
}

const ANDROID_ABIS = ['aarch64', 'armv7', 'x86_64']

function buildAndroid(extra: string[]) {
  // Belt and braces: cargo's release profile emits no debug info to begin with, so
  // this is a no-op there. It stays because `--debug` is still a supported override
  // via `extra`, and that build otherwise carries a debugger's worth of DWARF —
  // ~90% of the file, each ABI's .so going from ~346 MB to ~38 MB, for symbols
  // nothing on the device reads. The symbol *table* survives (that would be
  // `strip=symbols`), so a panic in logcat still names functions. Set here rather
  // than in Cargo.toml so `tauri:dev` on the desktop keeps its full backtraces;
  // with `--target` in play cargo won't apply it to host build scripts.
  const env = { ...androidEnv(), RUSTFLAGS: '-Cstrip=debuginfo' }

  // This used to be a debug build, because a release APK comes out *unsigned* and
  // Android refuses to install one — and there was no keystore to sign with. There
  // is now (see app/build.gradle.kts), which removes the only reason to ship a
  // build marked DEBUGGABLE: that flag lets anyone attach a debugger and read the
  // app's private data through `run-as` on any device. A release build also
  // optimises our own crate, not just its dependencies.
  //
  // The cost is R8: it renames anything it thinks is unreachable, and the
  // JavascriptInterface bridges are reachable only from the frontend. proguard-rules.pro
  // keeps them — check playback and TV detection still work after touching that file.
  console.log(`\n→ Building a signed release APK for ${ANDROID_ABIS.join(' + ')}\n`)
  run(['tauri', 'android', 'build', '--apk', '--target', ...ANDROID_ABIS, ...extra], env)

  const out = 'src-tauri/gen/android/app/build/outputs/apk/universal/release/'
  console.log(
    `\n✓ APK written under ${out}\n\n`
    + 'Install it:\n'
    + `  adb install -r ${out}app-universal-release.apk\n\n`
    + 'A file named *-release-unsigned.apk instead means the keystore was not in the\n'
    + 'environment (ANDROID_KEYSTORE_PATH); Android will refuse to install it.\n\n'
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

  let attached = adbDevices()
  if (!attached.length && await adbConnectNearby())
    attached = adbDevices()
  if (!attached.length) {
    die(
      'adb sees no device.\n'
      + '  Phone: enable Developer options → USB debugging, plug it in, and accept the\n'
      + '         "Allow USB debugging?" prompt on the phone itself (`adb devices` shows\n'
      + '         "unauthorized" until you do).\n'
      + '  TV box: Developer options → Network debugging, and put it on this network —\n'
      + '          it is then found here automatically, no `adb connect` needed.',
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

function adbDevices() {
  const out = spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout ?? ''
  return out.split('\n').slice(1).filter(l => /\tdevice$/.test(l.trim()))
}

/**
 * A TV box has no USB port to sit on, so its adb is a network connection — and
 * that connection is not the device's to keep: it is dropped by every reboot,
 * every toggle of the setting and every `adb kill-server` here, which is why it
 * needs making again from this machine each time. Network debugging advertises
 * `_adb._tcp` over mDNS whether or not anything is connected, so the box can be
 * found rather than have its IP pinned in the repo (it's a DHCP lease). adb
 * auto-connects only to `_adb-tls-connect._tcp`, Android 11's *wireless
 * debugging* — the plain 5555 service a TV's network debugging opens is left to
 * us. Discovery is a background daemon that has seen nothing the instant it
 * starts, hence the poll.
 */
async function adbConnectNearby() {
  for (let i = 0; i < 6; i++) {
    const out = spawnSync('adb', ['mdns', 'services'], { encoding: 'utf8' }).stdout ?? ''
    const found = [...out.matchAll(/\t_adb\._tcp\t(\S+:\d+)/g)].map(m => m[1]!)
    if (found.length) {
      for (const target of found) {
        console.log(`\n→ found ${target} over mDNS`)
        spawnSync('adb', ['connect', target], { stdio: 'inherit' })
      }
      return true
    }
    await Bun.sleep(500)
  }
  return false
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
