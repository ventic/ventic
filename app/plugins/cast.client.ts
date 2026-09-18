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
import type { CastPlay, CastSetup } from '~/utils/cast'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export default defineNuxtPlugin(() => {
  // `bun run dev` in a browser has no Rust under it to open a port or send an
  // event, and every call below would throw on the way to saying so.
  if (!isTauri())
    return

  const settings = useSettingsStore()
  const ui = useUiStore()

  /**
   * What the listener was last told. The first switch-on fills in a name and a
   * code, and those are two of the three things watched below — so without this
   * the watcher fires again on its own writes and asks Rust to restart a
   * listener it has only just started, on a port it is still holding.
   */
  let applied = ''

  /**
   * Bring the listener into line with the settings, filling in a name and a
   * code the first time it is switched on. Runs again whenever any of them
   * change, so renaming this device doesn't need a restart to be seen.
   */
  async function apply() {
    // The phone form is open (see pages/settings/phone.vue). The receiver is
    // what serves it, so it answers for as long as that screen is up — whether
    // or not this device takes casts at all, since the whole point is the
    // television nobody has set up yet. `null` is not a code, it is not being
    // shown; '' is a screen that asks for none.
    const pairing = ui.pairing

    if ((settings.castReceive || pairing !== null) && !settings.castName)
      settings.castName = isTv() ? $t('Ventic TV') : $t('Ventic')

    // A backup carries `castReceive` but never `castCode` — that one is SECRET —
    // so a restored device wakes up asking for a code it hasn't got. Mint one,
    // but only on the way up: doing it whenever the box is empty rewrites the
    // field under the fingers of somebody clearing it to type their own, which
    // is the whole point of the field being editable. Switching either switch on
    // mints one too, in settings/network.vue.
    if (!applied && settings.castReceive && settings.castAsk && !settings.castCode)
      settings.castCode = newCode()

    // No code at all is a deliberate answer and Rust reads it as one: a
    // household that wants any of its own screens to be able to hand a film to
    // the television without reading four digits off it first. It is never the
    // default, and never something an empty setting falls into by accident —
    // an empty box while a code *is* being asked for is neither answer, so the
    // listener stays down rather than standing open to the network for as long
    // as it takes somebody to type a new one.
    const code = pairing ?? (settings.castAsk ? settings.castCode : '')
    const on = pairing !== null || (settings.castReceive && (!settings.castAsk || !!code))

    const wanted = [on, settings.castName, code].join('|')
    if (wanted === applied)
      return
    applied = wanted

    try {
      await receiveCasts(on, settings.castName, code)
    }
    catch (e) {
      // A port already taken is the realistic failure, and the switch being on
      // while nothing answers is worth saying out loud rather than hiding.
      console.error('[ventic] casting to this device could not be turned on', e)
      applied = ''
      settings.castReceive = false
      // The phone form has nothing to serve it either, and the screen showing a
      // code says so rather than a QR nothing answers.
      ui.pairing = null
    }
  }

  watch(
    () => [settings.castReceive, settings.castName, settings.castAsk, settings.castCode, String(ui.pairing)].join('|'),
    () => apply(),
    { immediate: true },
  )

  listen<CastPlay>('cast://play', async event => {
    const player = localePath('/watch')
    // Casting the same film again lands on the *identical* route, and a router
    // does nothing with one of those — so a cast that failed on this screen
    // could never be retried from the other device: the second command arrived,
    // was accepted, and left the spinner from the first one exactly where it
    // was. Leaving the player first makes every command a fresh start.
    if (useRouter().currentRoute.value.path === player)
      await navigateTo(localePath('/'))
    await navigateTo({ path: player, query: castRoute(event.payload) })
  }).catch(() => {}) // no Tauri under `bun run dev`, and nothing to listen to

  // Somebody typed an address on their phone (see `setup` in cast.rs). It is
  // staged exactly as a `ventic://` link is and kept only if this screen says
  // yes — a device on the Wi-Fi may no more change what this app searches than
  // a web page may. The dialog belongs to the settings layout, so the page that
  // is showing the code is also the page that asks.
  listen<CastSetup>('cast://setup', async event => {
    ui.pending = event.payload
    // Never over a film. The dialog belongs to the settings layout and the
    // player has none, so showing it means leaving playback — and a film ended
    // by somebody else's phone is a worse answer than a question that waits for
    // the next time settings are opened.
    if (useRouter().currentRoute.value.path !== localePath('/watch'))
      await navigateTo(localePath('/settings/phone'))
  }).catch(() => {})

  // The sending device pressed Stop. It stops serving the film a moment later,
  // so a screen left on the player would sit there until the buffer ran dry and
  // then blame the network. Only from the player: a cast that has already been
  // left is nothing to act on, and Home is not somewhere to be sent from.
  listen('cast://stop', () => {
    if (useRouter().currentRoute.value.path === localePath('/watch'))
      navigateTo(localePath('/'))
  }).catch(() => {})
})
