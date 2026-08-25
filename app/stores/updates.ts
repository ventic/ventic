import type { Update } from '~/utils/updates'
import { invoke } from '@tauri-apps/api/core'

/**
 * Whether a newer Ventic exists, and what this particular install can do with
 * that — the two are not the same question and are answered separately.
 *
 * `available` is a fact about GitHub: `app/utils/updates.ts` asks the API, and
 * every build can, including Android and a browser dev session. `capable` is a
 * fact about how the app got onto the machine, and comes from Rust — a copy
 * apt, pacman, dnf or Nix installed is not ours to overwrite (see
 * `can_self_update` in `src-tauri/src/lib.rs`). When the two disagree the panel
 * still says a release is out, and points at it instead of installing it.
 *
 * Android is neither: no updater plugin exists for it and no app may overwrite
 * its own package. What it *can* do is download the new APK and open the system
 * installer on it, which is one confirmation away from the same thing — so
 * `canUpdate` is the question the panel actually asks, and `install()` picks the
 * path. Android's package manager only replaces a package with one signed by the
 * same key, and keeps the library when it does.
 */
export const useUpdatesStore = defineStore('updates', () => {
  /** The running version. Empty in a browser, where there is no Tauri to ask. */
  const current = ref('')
  const release = ref<Update | null>(null)
  const capable = ref(false)
  /**
   * `ready` is the desktop's "installed, restart to finish". `installing` is
   * Android's end of the road: the system installer is on screen and this
   * process is about to be replaced, so there is nothing left here to restart.
   */
  const status = ref<'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'failed'>('idle')
  const error = ref('')
  /** 0–1 while downloading. The bundle is ~100 MB, so this is worth showing. */
  const progress = ref(0)

  /**
   * A version the user waved off. Kept so the badge is a notification rather
   * than a permanent decoration — the About panel still offers it.
   */
  const skipped = useLocalStorage('ventic.updateSkipped', '')

  const available = computed(() =>
    release.value && isNewer(current.value, release.value.version) ? release.value : null)

  /**
   * Android's route: fetch the APK and hand it to the installer. Read from the
   * bridge rather than from `platform()`, so a build whose bridge failed to come
   * up falls back to the download link instead of offering a dead button.
   */
  const apk = computed(() => canInstallApk())

  /** Can this copy install the update itself, by either route? */
  const canUpdate = computed(() => capable.value || apk.value)

  const dismissed = computed(() => !!available.value && available.value.version === skipped.value)

  function dismiss() {
    skipped.value = available.value?.version ?? ''
  }

  /**
   * Once per launch, from `app.vue`. Never throws and never blocks anything:
   * offline is the ordinary case, not a failure worth a message.
   */
  async function check() {
    if (status.value === 'downloading' || status.value === 'ready')
      return
    status.value = 'checking'
    // Both of these fail in a browser-only dev session — `getVersion` rejects
    // and `invoke` has no backend — which leaves `current` empty and every
    // comparison false, so nothing is offered where nothing could be installed.
    current.value = await useTauriAppGetVersion().catch(() => '')
    capable.value = await invoke<boolean>('can_self_update').catch(() => false)
    release.value = await latestUpdate()
    status.value = 'idle'
  }

  /**
   * Download the new bundle and hand it to the platform's installer.
   *
   * This is the updater plugin's own `check()`, not the release we already
   * found: it reads the signed `latest.json` and carries the signature the
   * install is verified against, which the GitHub API never sees. The two can
   * disagree — a release whose manifest is missing this platform is a real
   * possibility — so a null there is reported rather than swallowed, and the
   * panel falls back to the download link.
   */
  async function install() {
    if (!available.value)
      return
    if (apk.value)
      return installUpdateApk()
    if (!capable.value)
      return
    status.value = 'downloading'
    progress.value = 0
    error.value = ''
    try {
      const update = await useTauriUpdaterCheck()
      if (!update)
        throw new Error($t('The release carries no update for this platform.'))

      let total = 0
      let done = 0
      await update.downloadAndInstall(event => {
        if (event.event === 'Started')
          total = event.data.contentLength ?? 0
        else if (event.event === 'Progress' && total)
          progress.value = (done += event.data.chunkLength) / total
        else if (event.event === 'Finished')
          progress.value = 1
      })
      // Windows never gets here: its installers require the app to be closed,
      // so the plugin exits the process partway through `downloadAndInstall`.
      status.value = 'ready'
    }
    catch (e) {
      status.value = 'failed'
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /**
   * The Android half: DownloadManager fetches the APK, then Android's own
   * package installer asks the user to confirm and replaces us in place.
   *
   * Polled rather than pushed, because the bridge is a synchronous JS interface
   * with no way to call back into the page — and a second's granularity is
   * plenty for a bar. The poll ends the moment the installer is up: from there
   * the process either gets replaced or the user cancels, and either way this
   * screen is not the one to report it.
   */
  async function installUpdateApk() {
    status.value = 'downloading'
    progress.value = 0
    error.value = ''

    // The APK of the exact release named on screen; the stable alias only
    // covers a release that shipped without one.
    const problem = installApk(available.value?.apk || APK_URL)
    if (problem) {
      status.value = 'failed'
      error.value = problem === 'permission'
        // The switch is one screen and one toggle, and we have just opened it.
        ? $t('Android needs your permission to install apps from Ventic. Turn it on, then press Update again.')
        : $t('The download couldn\'t be started.')
      return
    }

    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        const state = apkProgress()
        progress.value = state.progress ?? 0
        if (state.status === 'downloading')
          return
        clearInterval(timer)
        if (state.status === 'installing') {
          status.value = 'installing'
        }
        else {
          status.value = 'failed'
          error.value = $t('The download didn\'t finish.')
        }
        resolve()
      }, 1000)
    })
  }

  const restart = () => useTauriProcessRelaunch()

  return { current, release, capable, apk, canUpdate, status, error, progress, available, dismissed, dismiss, check, install, restart }
})
