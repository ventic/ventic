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
export default defineNuxtPlugin(() => {
  const ui = useUiStore()
  const settings = useSettingsStore()

  function stage(urls: string[] | null) {
    const source = (urls ?? []).map(normalizeSource).find(Boolean)
    if (!source || settings.sources.includes(source))
      return

    ui.pendingSource = source
    navigateTo(localePath('/settings/sources'))
  }

  // Both paths happen: `getCurrent` is the link that launched the app, and
  // `onOpenUrl` is one clicked while it was already running (which the
  // single-instance plugin forwards here rather than starting a second copy).
  // Neither exists in a browser-only dev session, where there is no Tauri.
  useTauriDeepLinkGetCurrent().then(stage).catch(() => {})
  useTauriDeepLinkOnOpenUrl(stage).catch(() => {})
})
