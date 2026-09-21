import type { AudioSettings, Leveller } from '~/utils/audio'
import type { Media } from '~/utils/tmdb'

/**
 * Levelling and the dialogue boost — see utils/audio.ts for what the two do.
 *
 * Pushed once the file is open and again on every edit, like the subtitle
 * style, and once more whenever the audio track changes: which filter fits
 * depends on the channel layout, and a 5.1 track and a stereo commentary want
 * different ones. That last one is why `setLayout` exists — the layout is
 * mpv's to report and arrives on the poll, a moment after the `aid` that
 * selected the track.
 */
export function usePlayerAudio(ctx: {
  /** mpv is behind this, so there is a filter graph to build. */
  native: boolean
  started: MaybeRefOrGetter<boolean>
  /** The title whose settings are in force, or undefined for a bare magnet. */
  media: MaybeRefOrGetter<Media | null | undefined>
  ipc: (command: unknown[]) => Promise<any>
  osd: (text: string, ms?: number) => void
}) {
  const { native, ipc, osd } = ctx
  const settings = useSettingsStore()

  /**
   * Which title's settings are in force — `movie:603`, `tv:1396`. Empty for a
   * bare magnet, which has no title to remember anything against.
   */
  const audioKey = computed(() => {
    const media = toValue(ctx.media)
    return media ? titleKey(media.type, media.id) : ''
  })

  /** A magnet's edits, which live as long as this playback and no longer. */
  const looseAudio = ref<AudioSettings | null>(null)

  /** What this film is actually playing with: its own settings, or the default. */
  const audio = computed(() => audioKey.value
    ? settings.audioFor(audioKey.value)
    : looseAudio.value ?? settings.audio)

  /** Has this film been given settings of its own? Then it can also be given them back. */
  const ownAudio = computed(() => !!audioKey.value && audioKey.value in settings.audioByTitle)

  /**
   * How mpv is decoding the track that is playing — `5.1(side)`, `stereo` — and
   * how many channels that is. Reported by the poll rather than asked for here:
   * a track only has a layout once mpv has reconfigured onto it.
   */
  let layout = { name: '', channels: 0 }

  async function applyAudio() {
    if (!toValue(ctx.started))
      return

    // ExoPlayer has no filter graph, so the two settings cross the bridge as
    // themselves and Player.kt decides what the platform's audio effects can do
    // with them. The <video> path answers neither and plays on unfiltered.
    if (!native) {
      for (const [name, value] of Object.entries(audioProps(audio.value)))
        ipc(['set_property', name, value])
      return
    }

    const chain = mpvAudioChain(audio.value, layout.name, layout.channels)
    if (!chain) {
      ipc(['af', 'clr', ''])
      return
    }

    // A layout mpv named and libavfilter won't parse takes the whole chain down
    // with it — the command answers "error running command" and the film plays
    // on unfiltered. The retry drops the one filter that names a layout and
    // keeps the levelling, which needs no layout at all.
    const res = await ipc(['af', 'set', chain])
    const plain = mpvAudioChain(audio.value)
    if (chain !== plain && res?.error && res.error !== 'success')
      ipc(['af', 'set', plain])
  }

  /**
   * What mpv says it is decoding, off the poll. Only a real change re-applies
   * the chain: the properties are read sixty times a minute and rebuilding the
   * graph on each would restart the filters mid-word.
   */
  function setLayout(name: string, channels: number) {
    if (name === layout.name && channels === layout.channels)
      return
    layout = { name, channels }
    applyAudio()
  }

  /** A fresh mpv carries no filters either, so the next report is a change again. */
  function forgetLayout() {
    layout = { name: '', channels: 0 }
  }

  // Whichever of the two is in force, and the settings page editing the default
  // while this is open counts as a change to a film that hasn't overridden it.
  watch(audio, applyAudio, { deep: true })

  /**
   * An edit here is about *this* film. One mix in twenty is the one you can't
   * hear a word of, and levelling every film afterwards because of that one
   * would be its own complaint — so the panel writes a per-title entry
   * (`setAudioFor`) and *Settings → Audio* keeps setting what everything else
   * starts from. Put back to the default and the entry is dropped again; see
   * `rememberAudio`.
   */
  function editAudio(next: AudioSettings) {
    if (audioKey.value)
      settings.setAudioFor(audioKey.value, next)
    else
      looseAudio.value = next
  }

  function setLevel(v: Leveller) {
    editAudio({ ...audio.value, normalize: v })
    osd(v === 'off' ? $t('Levelling off') : $t('Levelling: {level}', { level: LEVELLERS.find(l => l.value === v)!.title() }))
  }

  const boostText = computed(() => audio.value.dialogue ? `+${audio.value.dialogue} dB` : $t('Off'))

  function nudgeBoost(delta: number) {
    editAudio({ ...audio.value, dialogue: Math.min(MAX_DIALOGUE, Math.max(0, audio.value.dialogue + delta)) })
    osd($t('Dialogue: {boost}', { boost: boostText.value }))
  }

  /** Back to whatever everything else plays with. */
  function useDefaultAudio() {
    editAudio({ ...settings.audio })
    osd($t('Using the usual audio settings'))
  }

  return {
    audio,
    ownAudio,
    boostText,
    applyAudio,
    editAudio,
    setLevel,
    nudgeBoost,
    useDefaultAudio,
    setLayout,
    forgetLayout,
  }
}
