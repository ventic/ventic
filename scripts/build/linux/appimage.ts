/**
 * Take libwayland back out of the .AppImage.
 *
 * An AppImage's AppRun puts the bundle's own usr/lib in front of the entire
 * system on LD_LIBRARY_PATH, and linuxdeploy copies libwayland-* in because GTK
 * links it. That directory is then also where the *host's* Mesa looks — and a
 * Mesa newer than the build machine's wants symbols (`wl_proxy_get_queue`,
 * `wl_display_create_queue_with_name`, `wl_fixes_interface`, …) that the bundled
 * copy doesn't export. EGL fails to initialise, and WebKit aborts with
 *
 *   Could not create surfaceless EGL display: EGL_BAD_ALLOC. Aborting...
 *
 * before a window ever appears. Nothing about that is session-specific:
 * libEGL_mesa.so.0 links libwayland-client whether or not the user is on
 * Wayland, so an X11 desktop breaks identically. Since the releases are built
 * on the oldest supported distro, the bundled copy is older than nearly every
 * machine that runs it — the AppImage worked only on hosts no newer than CI.
 *
 * Dropping them is safe, and it is the documented rule rather than a local
 * workaround: libwayland-client.so.0 is on the AppImage project's own
 * excludelist ("New version of Mesa has some dependency issues with
 * libwayland-client if it is bundled"), which the tauri bundler doesn't apply.
 * The AppRun forces GDK_BACKEND=x11 so nothing in the bundle talks Wayland, and
 * any host that can run the app at all already has its own libwayland-client —
 * without one, Mesa's EGL doesn't load and there is nothing to render into.
 *
 *   bun scripts/build/linux/appimage.ts   → strip and repack whatever was built
 *
 * It runs *after* the bundler, because the AppDir it edits doesn't exist until
 * linuxdeploy has been and gone. That also means it can't be a tauri hook: it is
 * called both from scripts/build/index.ts and, because CI builds through
 * tauri-action and never touches that file, as its own step in the release
 * workflow.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const DIR = 'src-tauri/target/release/bundle/appimage'

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function unbundleWayland() {
  const built = existsSync(DIR) ? readdirSync(DIR) : []
  const image = built.find(f => f.endsWith('.AppImage'))
  if (!image)
    return // the AppImage wasn't one of the bundles asked for

  // linuxdeploy leaves the tree it packed behind, so the repack is the same
  // appimagetool the bundler downloaded, pointed back at an edited AppDir.
  const appdir = built.find(f => f.endsWith('.AppDir'))
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  const tool = join(cache, 'tauri', 'linuxdeploy-plugin-appimage.AppImage')
  if (!appdir || !existsSync(tool)) {
    die(
      `Built ${image}, but it still carries the build machine's libwayland and\n`
      + '  will abort on startup on any newer distro. Repacking it needs the\n'
      + `  AppDir and ${tool}, and one of those is missing.`,
    )
  }

  const libs = join(DIR, appdir, 'usr/lib')
  const dropped = readdirSync(libs).filter(f => f.startsWith('libwayland-'))
  // Nothing to do twice: re-running this, or a linuxdeploy that has learnt to
  // leave them out, should not rewrite the artifact for the sake of it.
  if (!dropped.length)
    return

  for (const lib of dropped)
    rmSync(join(libs, lib))

  const repack = spawnSync(tool, ['--appdir', join(DIR, appdir)], {
    stdio: 'inherit',
    env: { ...process.env, OUTPUT: join(DIR, image) },
  })
  if (repack.status !== 0)
    die(`Repacking ${image} without ${dropped.join(', ')} failed.`)

  console.log(`\n✓ ${image} repacked without ${dropped.join(', ')}\n`)
  resign(join(DIR, image))
}

/**
 * Sign the AppImage again, because the repack above just invalidated the
 * signature the bundler made — it signed the file as it was seconds earlier,
 * and `latest.json` names *that*. Left alone, the updater downloads the
 * AppImage that shipped, checks it against a signature for a file that no
 * longer exists, and refuses to install it. No Linux user would ever get an
 * update, and nothing about the release would look wrong.
 *
 * Whoever rewrites the file is who owes it a new signature, so it happens here
 * rather than in either caller. With no key in the environment there was no
 * signature to invalidate either, and this is a no-op.
 *
 * Putting the new signature into `latest.json` is a separate job on the release
 * — see scripts/build/linux/appimage-signature.ts for why it can't be done here.
 */
function resign(image: string) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY)
    return

  const signed = spawnSync('bun', ['run', 'tauri', 'signer', 'sign', image], { stdio: 'inherit' })
  if (signed.status !== 0)
    die(`Repacked ${image}, but could not sign it — the release would ship a signature for the file it replaced.`)

  console.log(`\n✓ ${image}.sig now covers the repacked file\n`)
}

// Called unconditionally by the build script; only Linux has an AppImage.
if (process.platform === 'linux')
  unbundleWayland()
