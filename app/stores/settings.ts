import type { AudioSettings } from '~/utils/audio'
import type { SubtitleStyle } from '~/utils/subtitles'
import {
  mdiAccountCircleOutline,
  mdiFolderOutline,
  mdiHeartOutline,
  mdiInformationOutline,
  mdiPaletteOutline,
  mdiPowerPlugOutline,
  mdiSubtitlesOutline,
  mdiTranslate,
  mdiTuneVariant,
  mdiWifi,
} from '@mdi/js'
import { DEFAULT_SOURCE } from '~/theme/presets'

export type SectionKey = 'appearance' | 'language' | 'sources' | 'subtitles' | 'audio' | 'network' | 'storage' | 'account' | 'support' | 'about'

/**
 * The sidebar of the settings layout, in the order it lists them. A `value` is
 * also the route the section lives at (`/settings/<value>`), so this table is
 * the whole registry: the sidebar, the heading and the URLs all come off it.
 *
 * `title` is a function because this list is built when the module loads, which
 * is before there is a Nuxt context for `$t` to read a locale from — and
 * because the labels have to change when the language does, which a string
 * baked in at import time never would.
 */
export const SECTIONS: { value: SectionKey, title: () => string, icon: string }[] = [
  { value: 'appearance', title: () => $t('Appearance'), icon: mdiPaletteOutline },
  { value: 'language', title: () => $t('Language'), icon: mdiTranslate },
  { value: 'sources', title: () => $t('Sources'), icon: mdiPowerPlugOutline },
  { value: 'subtitles', title: () => $t('Subtitles'), icon: mdiSubtitlesOutline },
  { value: 'audio', title: () => $t('Audio'), icon: mdiTuneVariant },
  { value: 'network', title: () => $t('Network'), icon: mdiWifi },
  { value: 'storage', title: () => $t('Storage'), icon: mdiFolderOutline },
  { value: 'account', title: () => $t('Account'), icon: mdiAccountCircleOutline },
  { value: 'support', title: () => $t('Support'), icon: mdiHeartOutline },
  { value: 'about', title: () => $t('About'), icon: mdiInformationOutline },
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
  /**
   * The UI language, as the bare code the locale list is keyed by: `sl`, not
   * `sl-SI`. Empty means "whatever the app opened in", which is the default
   * locale.
   *
   * This is only where the choice is *remembered* — @nuxtjs/i18n owns the live
   * one. app.vue is what marries the two: it restores this at boot and writes
   * it back whenever the locale changes. The module's own memory is a cookie,
   * which a `tauri://` origin does not reliably keep — and a `ventic.` key
   * travels in a backup, which a cookie also would not.
   */
  const locale = useLocalStorage('ventic.locale', '')

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

  /**
   * Quality to try first, '' for whatever streams best. A preference and not a
   * filter — see `setQuality` in utils/torrents, which is where it is enforced.
   */
  const quality = useLocalStorage('ventic.quality', '')

  // --- Live TV ---
  /**
   * M3U playlists to read channels from. A separate list from `sources` because
   * it is a separate thing: a source is a server answering the addon protocol,
   * a playlist is a text file of channels (see utils/iptv). Ships empty and
   * stays empty, for the same reason `sources` does.
   *
   * These carry credentials — an Xtream playlist URL has the account's password
   * in its query string — so the key is in `backup.ts`'s SECRET set and never
   * travels in an export.
   */
  const playlists = useLocalStorage<string[]>('ventic.playlists', [])

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

  // --- Casting ---
  /**
   * Answer play commands from other Ventics on this network. Off by default and
   * deliberately: it opens a port, and a television nobody asked to be cast to
   * is a television anyone on the Wi-Fi can interrupt.
   */
  const castReceive = useLocalStorage('ventic.castReceive', false)

  /** What this device is listed as by the one casting to it. */
  const castName = useLocalStorage('ventic.castName', '')

  /**
   * The pairing code this device shows and expects. Generated once and kept, so
   * the phone that has been paired stays paired — `ventic.castCode` is in
   * `backup.ts`'s SECRET set, since a code that travelled in an export would be
   * a code the export's reader can cast with.
   */
  const castCode = useLocalStorage('ventic.castCode', '')

  /**
   * The device this one casts to, remembered with the code that was typed for
   * it so the second cast is one press. Cleared by picking another.
   *
   * ponytail: one device. A second television is a re-scan, which is the same
   * two taps as picking it from a list would have been.
   */
  const castTarget = useLocalStorage<{ name: string, address: string, code: string } | null>('ventic.castTarget', null)

  // --- Storage ---
  /** Where torrents are written. '' = the app's own cache folder. */
  const downloadDir = useLocalStorage('ventic.downloadDir', '')

  // --- Subtitles ---
  // mergeDefaults: a build that adds a property must not read `undefined` out
  // of the copy stored by the build before it.
  const subs = useLocalStorage<SubtitleStyle>('ventic.subStyle', { ...SUBTITLE_DEFAULTS }, { mergeDefaults: true })

  /**
   * Turn subtitles on by themselves when a film starts, in `subLang`.
   *
   * The pair is one setting in two halves, and the player edits it as much as
   * this page does: picking a language while watching is what the *next* film
   * should open in, and turning subtitles off is how you say "not any more".
   * That was already the behaviour — it lived in `ventic.subLang`, which the
   * player cleared to mean off — this only gives it a name and a switch, so it
   * can be chosen up front instead of discovered.
   */
  const autoSubs = useLocalStorage('ventic.autoSubs', true)
  /** ISO 639 code, as the player last chose or the settings page last set. */
  const subLang = useLocalStorage('ventic.subLang', '')

  // --- Audio ---
  /**
   * Levelling and the dialogue boost — see utils/audio.ts for what each does.
   * mergeDefaults for the same reason the subtitle style has it.
   */
  const audio = useLocalStorage<AudioSettings>('ventic.audio', { ...AUDIO_DEFAULTS }, { mergeDefaults: true })

  /**
   * The films that needed something other than the above, by `titleKey` — the
   * player's Audio panel writes these, this page writes the default they fall
   * back to. See `pickAudio` for why the two are separate.
   */
  const audioByTitle = useLocalStorage<Record<string, AudioSettings>>('ventic.audioByTitle', {})

  /** What `key` should play with. An empty key (a bare magnet) gets the default. */
  function audioFor(key: string) {
    return pickAudio(audioByTitle.value, key, audio.value)
  }

  function setAudioFor(key: string, next: AudioSettings) {
    audioByTitle.value = rememberAudio(audioByTitle.value, key, next, audio.value)
  }

  function resetSubs() {
    subs.value = { ...SUBTITLE_DEFAULTS }
  }

  return { locale, theme, source, themeFromArt, colourFromPicture, customCss, uiScale, reduceEffects, sources, quality, playlists, tmdbKey, downLimit, upLimit, wifiOnly, castReceive, castName, castCode, castTarget, downloadDir, subs, autoSubs, subLang, audio, audioByTitle, audioFor, setAudioFor, resetSubs }
})
