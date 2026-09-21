import type { PieceMap } from '~/utils/torrents'
import { invoke } from '@tauri-apps/api/core'

/**
 * The frame under the cursor on the seek bar — but only ever for a position the
 * engine already holds.
 *
 * Decoding one it doesn't would have librqbit go and fetch that piece, and a
 * hover the user never commits to would be taking bandwidth off the film
 * currently playing. `haveAt` is what says no; a debrid release has no swarm to
 * take anything from, so those aren't gated at all.
 *
 * ffmpeg does the decoding, which is the same line `syncable` draws: the
 * `<video>` and ExoPlayer builds have no way to run it, so `native` turns the
 * whole thing off rather than each part of it.
 *
 * `heldSpan` rides along and is not about frames at all — it is what the
 * subtitle sync may read. It lives here because it wants the same answer from
 * the same two cached objects, and a second copy of that cache would refetch a
 * bitfield this one already has.
 */
export function useSeekPreview(ctx: {
  native: boolean
  src: MaybeRefOrGetter<string>
  position: MaybeRefOrGetter<number>
  duration: MaybeRefOrGetter<number>
  started: MaybeRefOrGetter<boolean>
  /** Another device's torrent: only what already played over there is sure to be held. */
  fromCast: MaybeRefOrGetter<boolean>
}) {
  const { native } = ctx
  const src = () => toValue(ctx.src)
  const duration = () => toValue(ctx.duration)

  /**
   * Long enough to coalesce a sweep across the bar, short enough to disappear
   * into the ~75ms the decode itself costs. Nearly all of that is fixed —
   * spawning ffmpeg, opening the file, seeking — so waiting longer buys no less
   * work.
   */
  const HOVER_MS = 80
  /** Frames are decoded per 5s bucket — finer than the eye wants at a film's scale. */
  const BUCKET = 5
  /**
   * How far off a stand-in frame may be. Generous on purpose: it goes up dimmed,
   * the time under it is exact, and the real frame replaces it a moment later. A
   * roughly right picture beats an empty box for that moment.
   */
  const NEAR_S = 60
  /** Where the walk starts before halving its way down to `BUCKET`. */
  const COARSE = BUCKET * 128

  const thumb = ref<string | null>(null)
  /** The frame up is a neighbour's, not this position's. Shown faded. */
  const approx = ref(false)
  /** Blob URL per bucket, `''` for a position ffmpeg had no frame at. */
  const thumbs = new Map<number, string>()
  /** Buckets ffmpeg is busy with, so a sweep can't queue the same one twice. */
  const pending = new Set<number>()
  let pieces: PieceMap | null = null
  let haves: Uint8Array | null = null
  let havesAt = 0
  let wanted = -1
  /**
   * Bumped to disown every decode in flight — the frame ffmpeg is working on is
   * of a film nobody is looking at any more, or isn't playing at all. Not the
   * cache's identity: hiding the bar calls the work off without throwing the
   * frames away.
   */
  let era = 0

  function cancelThumbs() {
    era++
  }

  function dropThumbs() {
    cancelThumbs()
    thumbs.forEach(url => url && URL.revokeObjectURL(url))
    thumbs.clear()
    pending.clear()
    thumb.value = null
    pieces = null
    haves = null
  }

  async function onDisk(at: number) {
    const parts = streamParts(src())
    // A plain URL has every byte one range request away. A cast mirror is
    // another device's torrent with nothing here to ask what it holds, and a
    // guess of "yes" would have every hover fetch pieces over there.
    if (!parts)
      return !toValue(ctx.fromCast)
    pieces ??= await pieceMap(parts.id, parts.index)
    // Refetched as the download grows. A stale bitfield only ever hides a frame
    // we could have shown, never invents one we haven't got.
    if (!haves || Date.now() - havesAt > 5000) {
      haves = await torrentHaves(parts.id)
      havesAt = Date.now()
    }
    return !!pieces && !!haves && haveAt(pieces, haves, at / (duration() || 1))
  }

  /**
   * Where the stretch of the film on disk around the picture starts and ends, as
   * fractions of it — what the subtitle sync may read (`playedSpan`). A plain
   * url has every byte one range request away; a cast mirror is another device's
   * torrent, and only what already played there is sure to be held.
   */
  async function heldSpan(): Promise<[number, number]> {
    const now = toValue(ctx.position) / (duration() || 1)
    const parts = streamParts(src())
    if (!parts)
      return toValue(ctx.fromCast) ? [0, now] : [0, 1]
    pieces ??= await pieceMap(parts.id, parts.index)
    haves = await torrentHaves(parts.id)
    havesAt = Date.now()
    return (pieces && haves && heldAround(pieces, haves, now)) || [now, now]
  }

  /** Decode one bucket into the cache, unless it's there or on its way. */
  async function grab(bucket: number) {
    if (thumbs.has(bucket) || pending.has(bucket))
      return
    const mine = era
    pending.add(bucket)
    try {
      // Left uncached when the bytes aren't down yet — unlike a miss, that is an
      // answer which changes as the download runs.
      if (!await onDisk(bucket))
        return
      const bytes = await invoke<ArrayBuffer>('thumbnail', { url: src(), at: bucket }).catch(() => null)
      // Next episode may have started while ffmpeg worked, and this frame is of
      // the last one — under a bucket number the new film will read as its own.
      if (mine !== era)
        return
      // Misses are remembered too: a position ffmpeg can't decode never will.
      thumbs.set(bucket, bytes?.byteLength ? URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })) : '')
    }
    finally {
      pending.delete(bucket)
    }
  }

  /**
   * Put up the best frame we have for `bucket`: its own, or a neighbour's faded
   * out. Over a film the walk has been across, that makes the bubble land filled
   * in and sharpen a moment later, rather than opening empty every time.
   */
  function show(bucket: number) {
    const exact = thumbs.get(bucket)
    approx.value = !exact
    thumb.value = exact || nearestFrame(thumbs, bucket, NEAR_S)
  }

  /**
   * Only where the cursor comes to rest gets decoded, not every pixel it swept.
   * `stop` on every move is what makes that true.
   */
  const { start: startHover, stop: stopHover } = useTimeoutFn(async (bucket: number) => {
    await grab(bucket)
    // The cursor may have moved on while ffmpeg worked.
    if (wanted === bucket)
      show(bucket)
    // A cursor that stopped is about to nudge. Both neighbours cost one ffmpeg
    // each against a wait the user would otherwise sit through twice.
    for (const near of [bucket - BUCKET, bucket + BUCKET]) {
      if (near >= 0 && near < duration())
        void grab(near)
    }
  }, HOVER_MS, { immediate: false })

  function onHover(at: number | null) {
    stopHover()
    if (at === null || !native || !duration()) {
      thumb.value = null
      return
    }

    const bucket = Math.floor(at / BUCKET) * BUCKET
    wanted = bucket
    show(bucket)
    // Cached, or cached as a position ffmpeg gets nothing from — either way there
    // is nothing left to decode.
    if (thumbs.has(bucket))
      return

    startHover(bucket)
  }

  /**
   * With the bar up, fill the cache in `walkOrder`'s order so a scrub lands on a
   * frame already in hand rather than waiting on ffmpeg for one.
   *
   * The bar is the whole trigger: it means someone is at the controls, and it
   * hides 2.8s into untouched playback — so a film watched straight through
   * never warms a single frame. One at a time, and every bucket goes through
   * `grab`, so the walk thins out by itself over a part-downloaded film.
   */
  let warming = false

  async function warm() {
    if (warming || !native || !toValue(ctx.started))
      return
    const mine = era
    warming = true
    try {
      for (const at of walkOrder(duration(), BUCKET, COARSE)) {
        // The bar hiding is a whole film's worth of work called off.
        if (mine !== era)
          return
        await grab(at)
      }
    }
    finally {
      warming = false
    }
  }

  // The blobs are this scope's to give back: a film left with a warmed cache is
  // a few hundred object URLs the document would otherwise hold for good.
  onScopeDispose(dropThumbs)

  return { thumb, approx, onHover, warm, cancelThumbs, dropThumbs, heldSpan }
}
