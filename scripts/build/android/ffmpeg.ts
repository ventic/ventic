/**
 * Build the media3 FFmpeg audio decoder, which is why Android can play a film
 * at all when the device's own decoder can't.
 *
 * Android answers `format_supported=YES` for E-AC-3 on a phone whose only
 * decoder is the vendor's Dolby one, and that decoder then rejects the first
 * frame of streams FFmpeg decodes without a complaint. There is nothing for
 * ExoPlayer's `setEnableDecoderFallback` to reach for — `media_codecs_dolby_c2.xml`
 * is the only file on such a device that mentions eac3 — and a WEB-DL usually
 * carries exactly one audio track, so one frame ended the whole film. That is
 * what "it plays in other apps" meant: every other player carries FFmpeg.
 * `retryInSoftware` in Player.kt is what uses this, and only after the hardware
 * has actually failed, so a TV wired to a receiver keeps its passthrough.
 *
 * Google does not publish this module to Maven — it links FFmpeg, which is
 * licensed separately (LGPL here: `--enable-shared` is off but nothing is
 * modified, and the sources are these two public repos at the pins below). So
 * it is built here and the .aar is checked in, the same bargain `mpv.ts`
 * strikes for Windows: a binary in the tree, and one script that reproduces it.
 *
 * Needs the Android SDK + NDK and a JDK (same environment as `build android`),
 * plus git and make. Takes about three minutes on a warm machine; the result is
 * ~3 MB, about 1.6 MB per ABI in the APK.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Pinned together on purpose. media3's JNI shim is written against a particular
 * FFmpeg API and its own README names the version it is tested with; a newer
 * FFmpeg compiles and then fails at a call site nobody looks at.
 *
 * `MEDIA3` must match the `androidx.media3:*` versions in app/build.gradle.kts —
 * the .aar is compiled against `lib-decoder` and loaded beside the Maven copy of
 * the same classes, so a drift is a NoSuchMethodError at the first film.
 */
const MEDIA3 = '1.8.0'
const FFMPEG = 'release/6.0'

/**
 * Only the decoders Android devices actually lack, plus the lossless ones a
 * remux carries. Every name here is a few hundred KB of .so, and this list is
 * the whole reason the module is 1.6 MB rather than 20: `--disable-everything`
 * is in media3's own build script and these are switched back on one at a time.
 *
 * ac3/eac3/dca/truehd (with mlp, which truehd is built on) are the ones that
 * fail in the field. The rest are cheap insurance for a container that a phone's
 * codec list happens not to cover.
 */
const DECODERS = ['ac3', 'eac3', 'dca', 'mlp', 'truehd', 'flac', 'alac', 'vorbis', 'opus', 'mp3', 'aac']

/** Where the finished .aar has to land for gradle to find it. */
const OUT = join(ROOT, 'src-tauri/gen/android/app/libs/media3-decoder-ffmpeg-1.8.0.aar')

function run(cmd: string, args: string[], cwd: string, env?: Record<string, string>) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

/**
 * The NDK the FFmpeg build compiles against. Its own toolchain is used for both
 * halves, so there is no second version to keep in step.
 */
function ndk() {
  const home = process.env.NDK_HOME ?? process.env.ANDROID_NDK_HOME
  if (home && existsSync(home))
    return home
  const sdk = process.env.ANDROID_HOME ?? join(process.env.HOME ?? '', 'Android/Sdk')
  const dir = join(sdk, 'ndk')
  if (!existsSync(dir))
    throw new Error(`No NDK found. Set NDK_HOME, or install one under ${dir}.`)
  const newest = execFileSync('ls', [dir]).toString().trim().split('\n').sort().pop()
  return join(dir, newest!)
}

const work = join(ROOT, '.ffmpeg-build')
const media3 = join(work, 'media3')
const ffmpeg = join(work, 'ffmpeg')
const jni = join(media3, 'libraries/decoder_ffmpeg/src/main/jni')

mkdirSync(work, { recursive: true })

if (!existsSync(media3))
  run('git', ['clone', '--depth', '1', '--branch', MEDIA3, 'https://github.com/androidx/media.git', media3], work)
if (!existsSync(ffmpeg))
  run('git', ['clone', '--depth', '1', '--branch', FFMPEG, 'https://github.com/FFmpeg/FFmpeg.git', ffmpeg], work)

// build_ffmpeg.sh reads the source through this symlink and nothing else.
if (!existsSync(join(jni, 'ffmpeg')))
  run('ln', ['-s', ffmpeg, join(jni, 'ffmpeg')], work)

// 21, not the app's minSdk of 24: the CMake half of the module is built at
// media3's own minSdk, and libavutil compiled at 24 references `stderr`, which
// bionic only exports from 23 — linking the two then fails on an undefined
// symbol with nothing in the message about API levels.
console.log(`\n→ Building FFmpeg ${FFMPEG} for 4 ABIs (${DECODERS.join(' ')})\n`)
run('./build_ffmpeg.sh', [join(media3, 'libraries/decoder_ffmpeg/src/main'), ndk(), 'linux-x86_64', '21', ...DECODERS], jni)

// AGP asks for whichever NDK *it* was built against and fails on a missing
// source.properties for a version nobody has installed. Env vars do not
// override that; `ndkVersion` in the module does. Written rather than pinned,
// so this tracks whatever NDK the machine has and the one that just compiled
// the static libraries is the one that links them.
const gradle = join(media3, 'libraries/decoder_ffmpeg/build.gradle')
const config = readFileSync(gradle, 'utf8')
if (!config.includes('ndkVersion')) {
  writeFileSync(gradle, config.replace(
    'namespace \'androidx.media3.decoder.ffmpeg\'',
    `namespace 'androidx.media3.decoder.ffmpeg'\n    ndkVersion '${basename(ndk())}'`,
  ))
}

console.log('\n→ Packaging the .aar\n')
run('./gradlew', ['--no-daemon', ':lib-decoder-ffmpeg:assembleRelease'], media3)

const built = join(media3, 'libraries/decoder_ffmpeg/buildout/outputs/aar/lib-decoder-ffmpeg-release.aar')
if (!existsSync(built))
  throw new Error(`gradle reported success but wrote no .aar at ${built}`)

mkdirSync(dirname(OUT), { recursive: true })
copyFileSync(built, OUT)
rmSync(join(jni, 'ffmpeg'), { force: true })

console.log(`\n✓ ${OUT}\n\n  Commit it. app/build.gradle.kts names this exact file.\n`)
