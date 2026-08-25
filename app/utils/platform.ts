import { platform } from '@tauri-apps/plugin-os'

/**
 * Does the network we're on charge for bytes — mobile data, or a metered
 * hotspot?
 *
 * Only Android can answer. Chromium never implemented
 * `navigator.connection.type` (`effectiveType` is a speed estimate, `saveData` a
 * user setting), so the bit comes from `ConnectivityManager` through the
 * `VenticScreen` bridge in MainActivity. `null` means nothing here can tell,
 * which is every desktop build and `bun run dev` — and the Wi-Fi-only setting
 * stays out of the way there rather than guessing.
 */
export function meteredNetwork(): boolean | null {
  return bridge()?.metered?.() ?? null
}

/**
 * Is this running on a television?
 *
 * Only Android can say: a TV webview's user agent claims Android like any
 * phone's, and the display gives it away no better — this set reports 960dp
 * wide, which is a small laptop as far as any breakpoint is concerned. It comes
 * from `UiModeManager` through the `VenticScreen` bridge. `null` is every other
 * build, where "is it a TV" isn't a question worth guessing at.
 */
export function isTv(): boolean | null {
  return bridge()?.tv?.() ?? null
}

/** One drive Android knows about. `free` is bytes. */
export interface StorageVolume {
  name: string
  path: string
  free: number
  /**
   * False for a drive that is plugged in and mounted but that Android refuses
   * to give this app a folder on — an NTFS stick in a TV, mounted read-only.
   * It has no `path` and nothing can be written to it; it is in the list so the
   * screen can say why, rather than showing nothing at all.
   */
  writable: boolean
  /**
   * Largest single file this drive accepts, or 0 when nothing caps it. 4 GiB on
   * FAT32, which is what a TV formats a stick as when its kernel supports
   * nothing else — so a film over that has to be kept off the drive rather than
   * failing at the last byte. Measured by MainActivity, not inferred.
   */
  maxFile: number
}

/**
 * The drives downloads can be sent to, built-in storage first and a plugged-in
 * USB stick or card after it. `null` everywhere else, where the platform has a
 * folder chooser and any path at all will do — Android has neither: it offers
 * no directory picker, and the only paths it will let us write are the app's
 * own folder on each volume (see MainActivity).
 *
 * Read once when asked, not watched: a drive plugged in later shows up the next
 * time the Storage screen is opened.
 */
export function storageVolumes(): StorageVolume[] | null {
  const json = bridge()?.volumes?.()
  if (!json)
    return null
  try {
    return JSON.parse(json) as StorageVolume[]
  }
  catch {
    return null
  }
}

/**
 * Send the user to Android's storage settings, where a drive can be erased and
 * formatted in whatever this device supports — the only reliable answer to "what
 * format does this box take", since no app can read that (see MainActivity).
 *
 * False when there is no such screen to open, and everywhere that isn't Android.
 */
export function openStorageSettings(): boolean {
  return bridge()?.openStorageSettings?.() ?? false
}

/** How the APK download started by `installApk` is going. */
export interface ApkInstall {
  status: 'downloading' | 'installing' | 'failed' | 'idle'
  /** 0–1, or undefined until the server says how big the file is. */
  progress?: number
}

/**
 * Can this build fetch a new APK and open the installer on it? Android only —
 * everywhere else updating is the Tauri updater plugin's, or nobody's.
 */
export function canInstallApk() {
  return !!bridge()?.installUpdate
}

/**
 * Start downloading `url` and hand it to Android's package installer when it
 * lands. Empty string when the download started; otherwise why it didn't —
 * `permission` means the user has been sent to the "install unknown apps"
 * switch and can try again once they have flipped it.
 */
export type ApkProblem = '' | 'permission' | 'insecure' | 'unavailable' | 'failed'

export function installApk(url: string): ApkProblem {
  return (bridge()?.installUpdate?.(url) ?? 'unavailable') as ApkProblem
}

/** Where that download has got to. Polled; see MainActivity's `updateProgress`. */
export function apkProgress(): ApkInstall {
  try {
    return JSON.parse(bridge()?.updateProgress?.() || '{}') as ApkInstall
  }
  catch {
    return { status: 'failed' }
  }
}

/** MainActivity's `Screen`, present only inside the Android app. */
function bridge() {
  return (globalThis as {
    VenticScreen?: {
      metered?: () => boolean
      volumes?: () => string
      tv?: () => boolean
      openStorageSettings?: () => boolean
      installUpdate?: (url: string) => string
      updateProgress?: () => string
    }
  }).VenticScreen
}

/**
 * Is this one of the three desktop builds — a real window, a shell, a webview
 * with a zoom of its own?
 *
 * The odd ones out are Android, which has none of that, and `bun run dev` in a
 * browser, where `platform()` throws because there is no Tauri under it at all.
 */
export function isDesktop() {
  try {
    return platform() === 'linux' || platform() === 'windows' || platform() === 'macos'
  }
  catch {
    return false
  }
}

/**
 * Can this OS show a folder in a file manager?
 *
 * Android can't, twice over: downloads land in a folder only this app is
 * allowed to read, and the shell plugin's `open` shells out to `xdg-open`/`gio`
 * — binaries that don't exist there, so every call fails with ENOENT. The
 * buttons are hidden rather than left to error.
 */
export function canOpenFolder() {
  return isDesktop()
}
