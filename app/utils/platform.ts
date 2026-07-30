import { platform } from '@tauri-apps/plugin-os'

/**
 * Can this OS show a folder in a file manager?
 *
 * Android can't, twice over: downloads land in the app's private cache, which
 * no other app is allowed to read, and the shell plugin's `open` shells out to
 * `xdg-open`/`gio` — binaries that don't exist there, so every call fails with
 * ENOENT. The buttons are hidden rather than left to error.
 */
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
  const bridge = (globalThis as { VenticScreen?: { metered?: () => boolean } }).VenticScreen
  return bridge?.metered?.() ?? null
}

export function canOpenFolder() {
  try {
    return platform() === 'linux' || platform() === 'windows' || platform() === 'macos'
  }
  catch {
    // Not running under Tauri at all, so there is no shell to open one with.
    return false
  }
}
