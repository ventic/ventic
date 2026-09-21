import type { Cue, Sync } from '~/utils/subtitles'
import { invoke } from '@tauri-apps/api/core'

/**
 * Timing. A file cut for another release is early or late, and one cut for
 * another framerate drifts — so the audio is read and the cues are lined up
 * against it (`bestSync` in utils/subtitles does the arithmetic).
 *
 * Desktop only, twice over: `audio_envelope` shells out to ffmpeg, which
 * Android has no way to run, and only a file we downloaded ourselves has cues
 * to line up at all — a muxed track is already cut to the release it ships in.
 */
export function useSubtitleSync(ctx: {
  native: boolean
  src: MaybeRefOrGetter<string>
  position: MaybeRefOrGetter<number>
  duration: MaybeRefOrGetter<number>
  /** The downloaded file currently showing, which is what this works on. */
  activeUrl: MaybeRefOrGetter<string>
  /** The unbroken stretch of the film on disk — see `useSeekPreview`. */
  heldSpan: () => Promise<[number, number]>
  ipc: (command: unknown[]) => Promise<any>
  osd: (text: string, ms?: number) => void
}) {
  const { native, ipc, osd } = ctx
  const duration = () => toValue(ctx.duration)

  const subDelay = ref(0)
  /** mpv's `sub-speed`. Only auto-sync ever moves it off 1. */
  const subSpeed = ref(1)
  const syncing = ref(false)
  /** The slow second pass is running: the whole film rather than what just played. */
  const syncWide = ref(false)
  const syncNote = ref('')
  /** The best fit of a pass that wasn't sure enough to apply itself. */
  const guess = ref<Sync | null>(null)

  const syncable = computed(() => native && !!probed(toValue(ctx.activeUrl))?.cues.length)

  // Two decimals, trailing zero trimmed: the fit lands well inside a tenth of a
  // second and rounding the display to one would show "+0.0s" for a real shift.
  const seconds = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2).replace(/0$/, '')}s`
  const delayText = computed(() => seconds(subDelay.value))
  const guessText = computed(() => seconds(guess.value?.offset ?? 0))

  /** The first look. Cheap to read, and enough for most files. */
  const SYNC_WINDOW = 1200

  function setDelay(seconds: number) {
    subDelay.value = Math.round(seconds * 100) / 100
    ipc(['set_property', 'sub-delay', subDelay.value])
  }

  /** Only ever 1 or one of `RATES`; a nudge of the delay leaves it alone. */
  function setSubSpeed(rate: number) {
    subSpeed.value = rate
    ipc(['set_property', 'sub-speed', rate])
  }

  function nudgeDelay(delta: number) {
    // Back onto the tenth-of-a-second grid: a fit leaves the delay somewhere in
    // between, and stepping from 0.14 to 0.24 reads like a stuck button.
    setDelay(Math.round((subDelay.value + delta) * 10) / 10)
    syncNote.value = ''
    guess.value = null
    osd($t('Subtitle delay {delay}', { delay: delayText.value }))
  }

  /** A fresh mpv starts at zero, and has been told nothing about this file. */
  function resetSync() {
    subDelay.value = 0
    subSpeed.value = 1
    syncNote.value = ''
    guess.value = null
  }

  /**
   * The audio behind `span` seconds of playback, clipped to what is on disk —
   * the unbroken stretch the picture is in (`heldSpan`). The bytes just played
   * used to be taken as certainly there, which a stream forgets as it goes and
   * a seek forward never fetched; ffmpeg reading outside the stretch pulls
   * pieces away from the film, or blocks on ones that never come.
   */
  async function playedSpan(span: number) {
    const whole = duration() || span
    const [lo, hi] = await ctx.heldSpan()
    const from = Math.max(lo * whole, Math.min(toValue(ctx.position) - span, whole - span), 0)
    const to = Math.max(from, Math.min(from + span, hi * whole))
    return { from, to, length: to - from }
  }

  async function fitOver(cues: Cue[], from: number, to: number) {
    const envelope = await invoke<number[]>('audio_envelope', {
      url: toValue(ctx.src),
      start: from,
      duration: to - from,
    })
    return bestSync(cues, Float32Array.from(envelope), from)
  }

  /**
   * Both numbers are absolute — the fit is measured from the file's own
   * timestamps — so this replaces a delay set by hand rather than adding to it.
   */
  function applyFit(fit: Sync) {
    const was = subDelay.value
    const wasSpeed = subSpeed.value
    setDelay(fit.offset)
    setSubSpeed(fit.speed)
    guess.value = null
    const moved = Math.abs(subDelay.value - was) >= 0.05 || fit.speed !== wasSpeed

    if (fit.speed !== 1) {
      // A rate error is global, so this one holds for the whole film rather than
      // just the scene it was measured on.
      syncNote.value = $t('This file was cut for a different framerate — stretched to fit, delay {delay}.', { delay: delayText.value })
      osd($t('Subtitles synced ({delay}, rate fixed)', { delay: delayText.value }), 2500)
    }
    else if (!moved) {
      syncNote.value = $t('Already in sync at {delay}.', { delay: delayText.value })
    }
    else {
      syncNote.value = $t('Delay set to {delay}.', { delay: delayText.value })
      osd($t('Subtitles synced ({delay})', { delay: delayText.value }), 2000)
    }
  }

  async function autoSync() {
    const file = probed(toValue(ctx.activeUrl))
    if (syncing.value || !file?.cues.length)
      return
    syncing.value = true
    syncNote.value = ''
    guess.value = null
    try {
      const near = await playedSpan(Math.min(SYNC_WINDOW, duration() || SYNC_WINDOW))
      let fit = near.length >= SYNC_MIN_WINDOW ? await fitOver(file.cues, near.from, near.to) : null

      // Twenty minutes of an old, quiet or sparsely-spoken film can honestly
      // mean anything — and the rest of the film is more of the same signal,
      // which is exactly what a weak one needs. Reading the lot is a few seconds
      // of ffmpeg on a normal encode and half a second of arithmetic — a minute
      // of I/O on a 4K remux, which is why it waits for the cheap look to fail
      // first, and only ever covers what the download has actually reached.
      if (!fit || !synced(fit)) {
        const all = await playedSpan(duration() || SYNC_WINDOW)
        if (all.length >= SYNC_MIN_WINDOW && all.length > near.length + 60) {
          syncWide.value = true
          const wide = await fitOver(file.cues, all.from, all.to)
          if (!fit || wide.confidence > fit.confidence)
            fit = wide
        }
      }

      if (!fit) {
        syncNote.value = $t('Not enough has played yet — auto-sync needs about {minutes} minutes of audio to be sure. Nudge the delay for now.', { minutes: Math.round(SYNC_MIN_WINDOW / 60) })
        return
      }

      if (!synced(fit)) {
        // A confident wrong answer is worse than none. The best it found is
        // still worth offering though: a file a minute out is unwatchable, and
        // one wrong button is cheaper than six hundred taps of the nudge.
        guess.value = fit.score > 0.05 ? fit : null
        syncNote.value = $t('Couldn\'t tell — the audio doesn\'t line up clearly with this file. Try a different subtitle file, or nudge the delay by hand.')
        return
      }

      applyFit(fit)
    }
    catch (e) {
      syncNote.value = e instanceof Error ? e.message : String(e)
    }
    finally {
      syncing.value = false
      syncWide.value = false
    }
  }

  return {
    syncable,
    subDelay,
    subSpeed,
    syncing,
    syncWide,
    syncNote,
    guess,
    delayText,
    guessText,
    setDelay,
    setSubSpeed,
    nudgeDelay,
    resetSync,
    applyFit,
    autoSync,
  }
}
