/**
 * `ventic://…` links, so adding a source is a click on a page rather than a URL
 * typed into a settings field from memory.
 *
 * A link never adds anything by itself. It stages the URL and opens the sources
 * settings, which asks first — a web page must not be able to change what the
 * app searches behind the user's back, and the confirmation is also the only
 * moment they get to see what they're trusting.
 *
 * No dedicated overlay component. The one place that can already show
 * and explain a source list is the settings section, so the link goes there.
 */
const SEEN = 'ventic-deeplink'

export default defineNuxtPlugin(() => {
  const ui = useUiStore()
  const settings = useSettingsStore()

  function stage(urls: string[] | null) {
    sessionStorage.setItem(SEEN, JSON.stringify(urls))
    const source = (urls ?? []).map(normalizeSource).find(Boolean)
    if (!source || settings.sources.includes(source))
      return

    ui.pending = { kind: 'source', url: source }
    navigateTo(localePath('/settings/sources'))
  }

  // Both paths happen: `getCurrent` is the link that launched the app, and
  // `onOpenUrl` is one clicked while it was already running (which the
  // single-instance plugin forwards here rather than starting a second copy).
  // Neither exists in a browser-only dev session, where there is no Tauri.
  //
  // `getCurrent` is the last link the *process* was handed, and the Rust side
  // never clears it — so every reload of the webview got the same link back and
  // asked again about a source already turned down. sessionStorage survives a
  // reload and not the process, which is exactly the lifetime of "already
  // asked". A link clicked while running always asks, even the same one twice.
  useTauriDeepLinkGetCurrent().then(urls => {
    if (JSON.stringify(urls) !== sessionStorage.getItem(SEEN))
      stage(urls)
  }).catch(() => {})
  useTauriDeepLinkOnOpenUrl(stage).catch(() => {})
})
