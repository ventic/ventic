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
 *
 * A third question sits on top of those two: *may we interrupt the user about
 * it*. That is `shouldPrompt`, and it is deliberately the narrowest of the
 * three — see it below.
 */
export const useUpdatesStore = defineStore('updates', () => {
  /** The running version. Empty in a browser, where there is no Tauri to ask. */
  const current = ref('')
  /**
   * Every published release GitHub handed back, newest first — not only the
   * newest one. Someone four versions behind is owed the four sets of notes,
   * and they arrive in the same single request either way.
   */
  const releases = ref<Update[]>([])
  const capable = ref(false)
  /** `linux`, `windows`, `macos`, `android`. Empty in a browser. */
  const platform = ref('')
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
   * A version the user asked never to hear about again. Kept so the badge is a
   * notification rather than a permanent decoration — the About panel still
   * offers it.
   */
  const skipped = useLocalStorage('ventic.updateSkipped', '')

  /**
   * Has the dialog had its turn this launch? Deliberately *not* stored: "not
   * now" means this launch, and `skipped` is the answer that outlives one.
   */
  const prompted = ref(false)

  /** The releases newer than the one running, newest first. */
  const missed = computed(() => releases.value.filter(r => isNewer(current.value, r.version)))

  const available = computed(() => missed.value[0] ?? null)

  /**
   * Android's route: fetch the APK and hand it to the installer. Read from the
   * bridge rather than from `platform()`, so a build whose bridge failed to come
   * up falls back to the download link instead of offering a dead button.
   */
  const apk = computed(() => canInstallApk())

  /** Can this copy install the update itself, by either route? */
  const canUpdate = computed(() => capable.value || apk.value)

  /**
   * Mid-update. The dismissal buttons come off while this is true: there is
   * nothing to put off any more, and "not now" over a running download reads
   * like a cancel it isn't.
   */
  const busy = computed(() => ['downloading', 'ready', 'installing'].includes(status.value))

  const dismissed = computed(() => !!available.value && available.value.version === skipped.value)

  /**
   * May the dialog interrupt? Every clause is a way of saying no, and the
   * middle one is the point of the whole thing: a copy that *can't* replace
   * itself — a .deb, an AUR build, Nix — has nothing to offer but a link to a
   * web page, and its package manager has probably updated it already. Those
   * installs keep the toolbar badge and are never interrupted.
   *
   * The last one is what stops it being a nag: one dialog a launch, whatever
   * closed it. Which route a page takes to *not* showing it is separate again —
   * it is mounted in the default layout, and the player has no layout at all,
   * so no dialog can land over a film.
   */
  const shouldPrompt = computed(() =>
    !!available.value && canUpdate.value && !dismissed.value && !prompted.value)

  /** Closed without answering: the badge stays and the dialog is back next launch. */
  function notNow() {
    prompted.value = true
  }

  /** Answered: this version is finished with, badge and all. */
  function skip() {
    skipped.value = available.value?.version ?? ''
    prompted.value = true
  }

  /**
   * Once per launch, from `app.vue`. Never throws and never blocks anything:
   * offline is the ordinary case, not a failure worth a message.
   */
  async function check() {
    if (busy.value)
      return
    status.value = 'checking'
    // Throws synchronously rather than rejecting where there is no Tauri at
    // all, which is every `bun run dev` browser session.
    try {
      platform.value = useTauriOsPlatform()
    }
    catch {}
    // Both of these fail in that same session — `getVersion` rejects and
    // `invoke` has no backend — which leaves `current` empty and every
    // comparison false, so nothing is offered where nothing could be installed.
    current.value = await useTauriAppGetVersion().catch(() => '')
    capable.value = await invoke<boolean>('can_self_update').catch(() => false)
    releases.value = await latestUpdates()
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

  return { current, platform, releases, capable, apk, canUpdate, busy, status, error, progress, missed, available, dismissed, prompted, shouldPrompt, notNow, skip, check, install, restart }
})
