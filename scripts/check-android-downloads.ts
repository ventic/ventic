// Self-check for the Android background download service:
// `bun scripts/check-android-downloads.ts`.
//
// Downloads.kt reads the engine's HTTP API a second time, in Kotlin, because the
// webview's timers are throttled exactly when its notification matters. That
// makes the field names a seam between two languages that no compiler checks:
// rename one on the TS side (librqbit renames it, we follow) and the service
// still builds, still runs, and silently reports 0% and never keeps the process
// awake — the failure looks like "Android killed us again", not like a typo.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { ENGINE } from '../app/utils/torrents'

const kotlin = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/java/com/ventic/app/Downloads.kt', import.meta.url),
  'utf8',
)
const torrents = readFileSync(new URL('../app/utils/torrents.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../app/stores/downloads.ts', import.meta.url), 'utf8')
const manifest = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)
const activity = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/java/com/ventic/app/MainActivity.kt', import.meta.url),
  'utf8',
)

// Every JSON name the service reads has to still be one the engine answers with,
// and app/utils/torrents.ts is where that contract is written down.
for (const field of [
  'torrents',
  'stats',
  'state',
  'error',
  'finished',
  'progress_bytes',
  'total_bytes',
  'live',
  'download_speed',
  'mbps',
]) {
  assert.ok(kotlin.includes(`"${field}"`), `Downloads.kt reads ${field}`)
  assert.ok(torrents.includes(field), `and the engine still answers with ${field}`)
}

// Same address, same query. A poll without `with_stats` returns no progress at
// all, so the notification would sit at 0% forever.
assert.ok(kotlin.includes(`"${ENGINE}"`), `Downloads.kt polls ${ENGINE}`)
assert.ok(kotlin.includes('/torrents?with_stats=true'), 'with stats, or there is no progress to show')

// The service's idea of "downloading" is torrentStatus()'s, minus the states
// that are nothing to hold the CPU awake for. Both sides have to agree on which
// those are, or a paused torrent keeps the phone from sleeping — or worse, a
// live one lets it sleep.
for (const state of ['paused']) {
  assert.ok(kotlin.includes(`== "${state}"`), `Downloads.kt skips ${state}`)
  assert.ok(store.includes(`'${state}'`), `and torrentStatus() still calls it ${state}`)
}

// A foreground service with no declaration, no type or no notification
// permission does not degrade — it throws on the call that promotes it, and the
// download stops the moment the app leaves the screen.
assert.ok(manifest.includes('android:name=".DownloadService"'), 'the service is declared')
assert.ok(manifest.includes('android:foregroundServiceType="dataSync"'), 'with its type (API 34+)')
for (const permission of [
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_DATA_SYNC',
  'POST_NOTIFICATIONS',
  'WAKE_LOCK',
]) {
  assert.ok(manifest.includes(`android.permission.${permission}`), `and holds ${permission}`)
}

// The other half of the same seam: "only download on Wi-Fi" asks Android whether
// the network is metered over the VenticScreen bridge, and a method renamed on
// one side of that is a setting that silently never fires.
const platform = readFileSync(new URL('../app/utils/platform.ts', import.meta.url), 'utf8')
assert.ok(activity.includes('fun metered()'), 'MainActivity answers metered()')
assert.ok(platform.includes('metered?.()'), 'and meteredNetwork() is what calls it')
assert.ok(platform.includes('VenticScreen'), 'through the interface MainActivity registers')
assert.ok(activity.includes('"VenticScreen"'), 'under that name')

// And the same again for the drive list, which is the only way to send downloads
// to a USB stick on a TV — Android offers no folder chooser, so a rename here
// leaves the storage screen with nothing to pick and no error either.
assert.ok(activity.includes('fun volumes()'), 'MainActivity answers volumes()')
assert.ok(platform.includes('volumes?.()'), 'and storageVolumes() is what calls it')
for (const field of ['name', 'path', 'free', 'writable', 'maxFile']) {
  assert.ok(activity.includes(`"${field}"`), `each drive carries ${field}`)
  assert.ok(platform.includes(field), `and StorageVolume still reads it as ${field}`)
}

// A drive Android mounted but won't create a folder on is dropped from
// getExternalFilesDirs without a word — an NTFS stick in a TV, which is the
// common case and reads as "the app can't see my USB". The second pass over
// getStorageVolumes is the only thing that finds it, and the storage screen
// only knows to explain it because that pass marks it unwritable.
assert.ok(activity.includes('storageVolumes'), 'MainActivity also asks StorageManager for every volume')
assert.ok(activity.includes('isRemovable'), 'to catch the removable ones it got no folder on')
const storageScreen = readFileSync(
  new URL('../app/pages/settings/storage.vue', import.meta.url),
  'utf8',
)
assert.ok(storageScreen.includes('v.writable'), 'and the storage screen splits the list on it')

// An app can neither format a drive nor read which filesystems the box supports
// (SELinux denies /proc/filesystems, FUSE hides a mounted volume's real type),
// so the one honest fix is Android's own format wizard. Lose this hop and the
// screen is back to naming a filesystem at a user with no computer to hand.
assert.ok(activity.includes('fun openStorageSettings()'), 'MainActivity opens the storage settings')
assert.ok(
  activity.includes('ACTION_INTERNAL_STORAGE_SETTINGS'),
  'with the intent the format wizard lives behind',
)
assert.ok(platform.includes('openStorageSettings?.()'), 'and openStorageSettings() calls it')
assert.ok(storageScreen.includes('openStorageSettings()'), 'from the storage screen button')
assert.ok(/FAT32/.test(storageScreen), 'with a written fallback when no such screen exists')

// The 4 GiB cap is measured by growing a file past it, because no API reports a
// volume's filesystem. Both halves have to survive: without the probe every
// drive looks unlimited, and without the fold into `maxBytes` the cap is known
// and ignored — which is a download that dies at 4 GiB either way.
assert.ok(activity.includes('FAT32_MAX'), 'MainActivity knows the FAT32 file ceiling')
assert.ok(activity.includes('setLength'), 'and measures it rather than guessing the filesystem')

// ...but that measurement is the most expensive thing in the app, and nothing
// about it looks expensive. On a filesystem with no sparse files — exFAT and
// FAT32, i.e. every SD card — `setLength(4 GiB)` allocates four real gigabytes,
// which is minutes on removable flash. Three rules keep that survivable, and all
// three are invisible in review: the failure is somebody else's phone freezing
// solid (issue #30, docs/android-unkillable-process.md).
function body(name: string) {
  const at = activity.indexOf(`fun ${name}(`)
  assert.ok(at > -1, `MainActivity still has ${name}()`)
  // To the next declaration at the same indent, which is where the body ends.
  const end = activity.slice(at).search(/\n {2}(?:override |private |\/\*\*)/)
  return end > -1 ? activity.slice(at, at + end) : activity.slice(at)
}

// 1. Never on the calling thread. Every @JavascriptInterface method is
//    *synchronous* — the WebView renderer blocks on an IPC until Kotlin returns
//    — so a slow one is a frozen page, not a slow one.
assert.ok(/Thread\s*\{/.test(body('probeFileLimit')), 'the probe runs on a thread of its own')
assert.ok(
  !body('maxFile').includes('setLength'),
  'and maxFile() never grows the file itself, or it blocks the renderer that asked',
)

// 2. Once per drive, not once per call. The downloads store asks every ten
//    seconds, for free space that genuinely moves; a volume's maximum file size
//    cannot change while it is mounted.
assert.ok(activity.includes('fileLimits'), 'measured limits are cached')
assert.ok(/fileLimits\[[^\]]+\]\?\.let\s*\{\s*return/.test(body('maxFile')), 'and maxFile() answers from that cache')

// 3. Removable drives only. Built-in storage cannot be FAT32 — Android needs
//    POSIX permissions, xattrs and hard links out of /data — so a phone with no
//    card slot should never pay for this at all.
assert.ok(/if\s*\(!removable\)\s*return/.test(body('maxFile')), 'and only a removable drive is worth probing')
assert.ok(activity.includes('maxFile(dir, free, volume?.isRemovable == true)'), 'which volumes() is what decides')

// The probe's `finally` cannot run through a SIGKILL, and what it leaves is 4 GiB
// of nothing that Android reports as the app's own storage — the "4.3 GB on a
// fresh install" half of issue #30. Clearing it at startup is the only thing that
// gets it off a phone that already has one.
assert.ok(activity.includes('SIZE_PROBE'), 'the probe file is named in one place')
assert.ok(/clearStaleProbes\(\)/.test(body('onCreate')), 'and a leftover is deleted at startup')
assert.ok(store.includes('fileLimit'), 'the store carries it')
assert.ok(
  /Math\.min\(budget\.value, fileLimit\.value\)/.test(store),
  'and folds it into the ceiling pickBest already applies to a release',
)
const picker = readFileSync(new URL('../app/components/TorrentPicker.vue', import.meta.url), 'utf8')
assert.ok(picker.includes('downloads.fileLimit'), 'and the picker dims what will not fit')

// Formatting a drive means leaving the app for Android's settings, so the list
// has to be re-read on the way back or the screen shows the old drive and the
// user is left switching tabs to force it — which is how this was reported.
assert.ok(storageScreen.includes('visibilitychange'), 'the drive list re-reads when the app returns')
assert.ok(storageScreen.includes('useTimeoutFn'), 'and again once Android has finished mounting')

// onPause is the last moment a service may promote itself to the foreground
// (API 31+), and onResume the only thing that brings it back after Android
// stopped it while idle. Losing either leaves the notification to luck.
for (const hook of ['onResume', 'onPause']) {
  assert.ok(
    new RegExp(`${hook}\\(\\)[^}]*nudgeDownloads`, 's').test(activity),
    `MainActivity starts the service from ${hook}`,
  )
}
assert.ok(activity.includes('stopService'), 'and closing the app stops it, notification and all')

// A TV box is armv7, where off_t is 32 bits — so librqbit's pwritev-based chunk
// writer cannot address past 2 GiB and every film bigger than that dies with
// "error writing to file 0". The storage wrapper in lib.rs exists only to drop
// that one method and inherit the trait's pwrite64 default, so the three ways it
// can quietly stop working are all worth an assert: unwired, "completed" with
// the vectored method someone assumed was missing by accident, or answering
// is_type_id as itself. That last one is not a slow degradation: session
// persistence refuses a factory that doesn't report as FilesystemStorageFactory,
// and the refusal comes back as a 400 on the add — no torrent starts at all.
const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
assert.ok(
  /default_storage_factory: Some\(Box::new\(LargeFileStorageFactory/.test(rust),
  'the session writes through the 64-bit-offset storage',
)
assert.ok(
  !/fn pwrite_all_vectored/.test(rust),
  'which works by not implementing pwrite_all_vectored at all',
)
assert.ok(
  /fn is_type_id[^}]*self\.0\.is_type_id/.test(rust),
  'and reports as the filesystem storage it wraps',
)
// `.boxed()` is the trap: its private wrapper answers is_type_id with the
// wrapped factory's own concrete id and never calls the override above, so the
// engine turned down every magnet with 400 "storages other than
// FilesystemStorageFactory are not supported". Boxing it directly is what keeps
// the override in the vtable. Found on the TV, not by reading.
assert.ok(
  !/LargeFileStorageFactory[^\n]*\.boxed\(\)/.test(rust),
  'and is boxed directly, since StorageFactoryExt::boxed() would discard that',
)

console.log('android downloads: ok')
