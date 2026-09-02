import type { SyncConfig } from '~/utils/sync'

/**
 * The sync loop: pull, merge, write, push. `utils/sync.ts` owns every rule about
 * what* merges; this only decides when, and how a merge lands on a page that is
 * already running.
 */
export const useSyncStore = defineStore('sync', () => {
  /**
   * In `backup.ts`'s SECRET set — it holds the password to somebody's drive, and
   * a backup file is a thing people mail to themselves. It is also in `NEVER`,
   * so a sync can't sync its own address to another device.
   */
  const config = useLocalStorage<SyncConfig>('ventic.sync', { ...SYNC_DEFAULTS }, { mergeDefaults: true })

  const running = ref(false)
  const error = ref('')

  const on = computed(() => !!config.value.url.trim())

  /**
   * What was last sent, so an untouched library isn't uploaded every five
   * minutes. Deliberately not stored: one redundant PUT per launch is cheaper
   * than a stale marker that skips a real one.
   */
  let sent = ''

  /**
   * Land a merge on a page that is already up.
   *
   * Every store read its localStorage ref once, at setup, and the browser fires
   * `storage` only for *other* documents — so a bare `setItem` would sit in
   * storage with nothing on screen moving until the next launch. VueUse's
   * `useStorage` listens for that event, so dispatching it ourselves is what
   * makes a pull visible, without this file knowing a single store's name.
   */
  function write(keys: Record<string, string>) {
    for (const [key, value] of Object.entries(keys)) {
      if (localStorage.getItem(key) === value)
        continue
      localStorage.setItem(key, value)
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, storageArea: localStorage }))
    }
  }

  async function run() {
    if (!on.value || running.value)
      return
    running.value = true
    error.value = ''

    try {
      const remote = await pull(config.value)
      const merged = mergeKeys(makeBackup(localStorage).keys, remote?.keys ?? {}, config.value.base, config.value.groups)
      write(merged.local)

      const payload = JSON.stringify(merged.remote)
      if (payload !== sent) {
        await push(config.value, JSON.stringify({ app: 'ventic', version: 1, at: Date.now(), keys: merged.remote }))
        sent = payload
      }

      config.value.base = baseOf(merged.remote)
      config.value.at = Date.now()
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    finally {
      running.value = false
    }
  }

  /** Stop syncing and forget the credentials. Nothing local is touched. */
  function disconnect() {
    config.value = { ...SYNC_DEFAULTS, groups: { ...config.value.groups } }
    error.value = ''
    sent = ''
  }

  return { config, running, error, on, run, disconnect }
})
