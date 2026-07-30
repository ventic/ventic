// The two pieces of the seek-preview cache worth pinning down. Everything else
// about it — spawning ffmpeg, the download gate, blob lifetimes — is bound to a
// live player and lives in MpvPlayer.vue; these two are arithmetic, and getting
// either subtly wrong shows up only as previews that quietly never appear.

/**
 * The order to decode a film's frames in: one every `coarse` seconds, then the
 * midpoints of those, then theirs, down to one every `bucket`.
 *
 * Coarse first because a frame every ten minutes is useless to look at but is
 * exactly what `nearestFrame` needs to stop the bubble opening empty anywhere in
 * the film. Each pass halves the error from there. Walking start to end instead
 * would leave the back half blank for as long as it took to reach it.
 *
 * Positions repeat across passes — the caller is expected to skip what it has,
 * which costs one `Map` lookup against the alternative of tracking them here.
 */
export function* walkOrder(duration: number, bucket: number, coarse: number) {
  for (let stride = coarse; stride >= bucket; stride /= 2) {
    for (let at = 0; at < duration; at += stride)
      yield at
  }
}

/**
 * The frame in `frames` closest to `at`, to stand in while the exact one is
 * still decoding. Null when the nearest is further off than `within`, or when
 * all we hold nearby are the empty strings that mark a position ffmpeg had
 * nothing at.
 */
export function nearestFrame(frames: Map<number, string>, at: number, within: number) {
  let best: string | null = null
  let closest = within
  for (const [t, url] of frames) {
    const gap = Math.abs(t - at)
    if (url && gap <= closest) {
      best = url
      closest = gap
    }
  }
  return best
}
