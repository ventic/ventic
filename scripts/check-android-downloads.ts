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
for (const field of ['name', 'path', 'free']) {
  assert.ok(activity.includes(`"${field}"`), `each drive carries ${field}`)
  assert.ok(platform.includes(field), `and StorageVolume still reads it as ${field}`)
}

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

// eslint-disable-next-line no-console
console.log('android downloads: ok')
