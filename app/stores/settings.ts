import type { SubtitleStyle } from '~/utils/subtitles'
import {
  mdiAccountCircleOutline,
  mdiFolderOutline,
  mdiInformationOutline,
  mdiPaletteOutline,
  mdiPowerPlugOutline,
  mdiSubtitlesOutline,
  mdiWifi,
} from '@mdi/js'
import { DEFAULT_SOURCE } from '~/theme/presets'

export type SectionKey = 'appearance' | 'sources' | 'subtitles' | 'network' | 'storage' | 'account' | 'about'

/** The sidebar of the settings layout, in the order it lists them. */
export const SECTIONS: { value: SectionKey, title: string, icon: string }[] = [
  { value: 'appearance', title: 'Appearance', icon: mdiPaletteOutline },
  { value: 'sources', title: 'Sources', icon: mdiPowerPlugOutline },
  { value: 'subtitles', title: 'Subtitles', icon: mdiSubtitlesOutline },
  { value: 'network', title: 'Network', icon: mdiWifi },
  { value: 'storage', title: 'Storage', icon: mdiFolderOutline },
  { value: 'account', title: 'Account', icon: mdiAccountCircleOutline },
  { value: 'about', title: 'About', icon: mdiInformationOutline },
]

/**
 * Everything the settings page edits, kept in localStorage — there is no
 * account yet, so "local" is the only place settings can live.
 *
 * Kept in localStorage, like every other preference in the app, rather than
 * tauri-plugin-store. The webview's storage is per-app and survives updates;
 * the day settings have to sync to a backend, this store is the one thing that
 * changes.
 */
export const useSettingsStore = defineStore('settings', () => {
  // Which section the drawer has open. Deliberately not a route and not
  // persisted: Back should leave settings, not walk through every section that
  // was opened on the way in, and a fresh visit starts at the top.
  const section = ref<SectionKey>('appearance')

  // --- Appearance ---
  const theme = useLocalStorage('ventic.theme', 'dark')
  /** The colour the "Your colour" themes are generated from (see theme/palette). */
  const source = useLocalStorage('ventic.themeSource', DEFAULT_SOURCE)
  /**
   * Build the palette from whatever is on screen instead, re-reading it every
   * time the art changes. Drives the same two generated themes as `source`
   * does, so it costs no extra palette — see `app.vue`.
   */
  const themeFromArt = useLocalStorage('ventic.themeFromArt', false)
  /**
   * Whether a picture of the user's own counts as "what's on screen". Off, only
   * a title's artwork moves the palette and the picture the app rests on leaves
   * the theme's own colours alone — which is the point of choosing a theme and a
   * background that go together.
   */
  const colourFromPicture = useLocalStorage('ventic.colourFromPicture', false)
  /** Injected as a plain <style> tag, so it outranks everything in a layer. */
  const customCss = useLocalStorage('ventic.customCss', '')
  /** Zoom for the whole interface. 1 = the sizes the app ships with. */
  const uiScale = useLocalStorage('ventic.uiScale', 1)
  /**
   * Drop the effects that cost the most frames — see `.reduce-effects` in
   * assets/css/layers.css for exactly which. Defaults on for a television,
   * which is the hardware that needs it: the set this was measured on took ten
   * d-pad moves at 13fps with these effects and 23 without them.
   * `isTv()` reads a bridge Android installs before the page loads, so it
   * answers correctly the first time the store is built.
   */
  const reduceEffects = useLocalStorage('ventic.reduceEffects', isTv() ?? false)

  // --- Sources ---
  /**
   * Servers to search for something to play. Ships empty and stays empty until
   * the user adds one: the app comes with no sources and suggests none.
   */
  const sources = useLocalStorage<string[]>('ventic.sources', [])

  // --- Film data ---
  /**
   * A TMDB read token of the user's own, used instead of the one the build
   * ships with. The bundled token sits in the client bundle where anyone can
   * read it, so it is one complaint away from being revoked — and a revoked
   * token is every installed copy losing artwork, titles and search at once.
   * This is the way back from that without waiting for a release.
   */
  const tmdbKey = useLocalStorage('ventic.tmdbKey', '')

  // --- Network ---
  // MB/s, 0 meaning "work it out" (see `uploadLimit` in utils/torrents).
  const downLimit = useLocalStorage('ventic.downLimit', 0)
  const upLimit = useLocalStorage('ventic.upLimit', 0)

  /** Android only — no other platform can tell a metered network from a free one. */
  const wifiOnly = useLocalStorage('ventic.wifiOnly', false)

  // --- Storage ---
  /** Where torrents are written. '' = the app's own cache folder. */
  const downloadDir = useLocalStorage('ventic.downloadDir', '')

  // --- Subtitles ---
  // mergeDefaults: a build that adds a property must not read `undefined` out
  // of the copy stored by the build before it.
  const subs = useLocalStorage<SubtitleStyle>('ventic.subStyle', { ...SUBTITLE_DEFAULTS }, { mergeDefaults: true })

  function resetSubs() {
    subs.value = { ...SUBTITLE_DEFAULTS }
  }

  return { section, theme, source, themeFromArt, colourFromPicture, customCss, uiScale, reduceEffects, sources, tmdbKey, downLimit, upLimit, wifiOnly, downloadDir, subs, resetSubs }
})
