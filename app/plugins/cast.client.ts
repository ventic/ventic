/**
 * The receiving half of casting: this device answering "play this" from another
 * Ventic on the same network.
 *
 * The command carries a URL and nothing else of consequence (see utils/cast),
 * so acting on one is a navigation — the player is driven entirely by its route,
 * and a cast lands on exactly the path a live channel or a debrid link takes.
 *
 * The port is only open while the setting is on, and the code is checked in
 * Rust before any of this hears about it. What arrives here has already been
 * vetted; what it *says* is still somebody else's text, so it goes into the
 * route as query values and nowhere near a template.
 */
import type { CastPlay } from '~/utils/cast'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export default defineNuxtPlugin(() => {
  // `bun run dev` in a browser has no Rust under it to open a port or send an
  // event, and every call below would throw on the way to saying so.
  if (!isTauri())
    return

  const settings = useSettingsStore()

  /**
   * Bring the listener into line with the settings, filling in a name and a
   * code the first time it is switched on. Runs again whenever any of the three
   * change, so renaming this device doesn't need a restart to be seen.
   */
  async function apply() {
    try {
      if (settings.castReceive) {
        if (!settings.castCode)
          settings.castCode = newCode()
        if (!settings.castName)
          settings.castName = isTv() ? $t('Ventic TV') : $t('Ventic')
      }
      await receiveCasts(settings.castReceive, settings.castName, settings.castCode)
    }
    catch (e) {
      // A port already taken is the realistic failure, and the switch being on
      // while nothing answers is worth saying out loud rather than hiding.
      console.error('[ventic] casting to this device could not be turned on', e)
      settings.castReceive = false
    }
  }

  watch(
    () => [settings.castReceive, settings.castName, settings.castCode].join('|'),
    () => apply(),
    { immediate: true },
  )

  listen<CastPlay>('cast://play', event => {
    navigateTo({ path: localePath('/watch'), query: castRoute(event.payload) })
  }).catch(() => {}) // no Tauri under `bun run dev`, and nothing to listen to
})
