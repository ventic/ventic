import { invoke } from '@tauri-apps/api/core'

/**
 * Where mpv's window goes, in the pixels the platform measures it in.
 *
 * Only the two backends that embed a real window ever ask (X11 and Win32); the
 * macOS one draws into the page's own layer and the two shims are laid out by
 * CSS like anything else, so `MpvPlayer` simply never calls `push` there. Split
 * out of that component because none of it is about playback: it is a box on a
 * page, a scale factor, and the holes the chrome has to show through.
 */

interface Rect { x: number, y: number, width: number, height: number }

/**
 * What has to show through mpv's window. `[data-cut]` is the player's own bars;
 * the second half is every Vuetify overlay — a tooltip, and the cast dialog the
 * bar opens. Those teleport to the app root, so a search scoped to the player
 * would never find them and mpv would paint over them: an open dialog that dims
 * the screen and then shows nothing, which is what it did.
 */
const CUT = '[data-cut], .v-overlay--active > .v-overlay__content'

export function useNativeSurface(boxEl: Ref<HTMLElement | null>, overlay: boolean) {
  /**
   * CSS px → physical px, measured rather than worked out.
   *
   * Only mpv needs this, and app scale on every target mpv runs on is the
   * webview's own page zoom (`app.vue`) — which the engines fold into
   * `devicePixelRatio` or leave beside it, and disagree about. Getting it wrong
   * parks mpv's window in the wrong place, so nothing here reasons about it: ask
   * the platform how many real pixels wide this webview is and divide by how
   * many the page thinks it is.
   *
   * Re-measured whenever the CSS viewport changes width, which is what a resize
   * and a change of zoom both do — no listener, and no round trip per frame. The
   * value it starts at is right for the ordinary case of no zoom at all, so the
   * frame or two before the first answer lands is not a jump.
   */
  let pxRatio = window.devicePixelRatio || 1
  let measuredAt = 0

  function readScale() {
    const css = window.innerWidth
    if (css === measuredAt || !css)
      return
    measuredAt = css
    useTauriWebviewWindowGetCurrentWebviewWindow().size().then(size => (pxRatio = size.width / css)).catch(() => {
      // No answer to be had — `devicePixelRatio` is what it keeps, which is
      // right for the only case that reaches here with mpv running: no zoom.
    })
  }

  /**
   * The webview viewport, in the same physical pixels the box is measured in.
   *
   * Sent alongside every geometry push for the backend that places its surface
   * by ratio rather than by scale factor (macOS — see `player_render_mac.rs`).
   * The X11 and Win32 backends are already in the units they need and ignore it.
   */
  function viewport(dpr: number) {
    return {
      viewW: Math.max(1, Math.round(window.innerWidth * dpr)),
      viewH: Math.max(1, Math.round(window.innerHeight * dpr)),
    }
  }

  /** Every overlay's rectangle, clipped to the video box and in physical pixels. */
  function cutouts(box: DOMRect, dpr: number): Rect[] {
    const out: Rect[] = []
    // A closed tooltip is `display: none` and measures 0x0, which the clip drops.
    for (const el of document.querySelectorAll<HTMLElement>(CUT)) {
      const r = el.getBoundingClientRect()
      const left = Math.max(r.left, box.left)
      const top = Math.max(r.top, box.top)
      const right = Math.min(r.right, box.right)
      const bottom = Math.min(r.bottom, box.bottom)
      if (right - left < 1 || bottom - top < 1)
        continue // fully outside the video (mid-slide, or off-screen)
      out.push({
        x: Math.round((left - box.left) * dpr),
        y: Math.round((top - box.top) * dpr),
        width: Math.round((right - left) * dpr),
        height: Math.round((bottom - top) * dpr),
      })
    }
    return out
  }

  /**
   * The box as the platform measures it, re-reading the scale first.
   *
   * `wire` is what every geometry call sends and is the same for both of them —
   * `player_start` places the window once and `push` keeps it there, and a
   * second copy of this arithmetic in the caller is how those two come to
   * disagree about where the picture is.
   */
  function measure() {
    const el = boxEl.value
    if (!el)
      return null
    const rect = el.getBoundingClientRect()
    readScale()
    const dpr = pxRatio
    return {
      rect,
      dpr,
      wire: {
        ...viewport(dpr),
        x: Math.round(rect.left * dpr),
        y: Math.round(rect.top * dpr),
        width: Math.max(1, Math.round(rect.width * dpr)),
        height: Math.max(1, Math.round(rect.height * dpr)),
      },
    }
  }

  let lastKey = ''

  /**
   * Put the surface where the box is, if it has moved. Called once a frame, so
   * the string compare is what keeps it to one IPC call per real change rather
   * than sixty a second.
   */
  function push() {
    const m = measure()
    if (!m)
      return
    const { rect: r, dpr } = m
    // Hide the native surface when the box is off-screen or not laid out —
    // otherwise it keeps painting over whatever the page scrolls under it.
    const visible = r.width >= 16 && r.height >= 16
      && r.bottom > 0 && r.top < window.innerHeight
      && r.right > 0 && r.left < window.innerWidth

    const geom = {
      ...m.wire,
      visible,
      // Only a surface in front of the page needs holes cutting in it.
      cutouts: visible && overlay ? cutouts(r, dpr) : [],
    }
    const key = JSON.stringify(geom)
    if (key === lastKey)
      return
    lastKey = key
    invoke('player_set_geometry', geom).catch(() => {})
  }

  /**
   * Forget where the surface was, so the next frame pushes whatever it finds.
   * A film that starts or stops is a new window either way, and the compare
   * above would otherwise skip the first push as a no-change.
   */
  function reset() {
    lastKey = ''
  }

  /**
   * mpv fails to create its video output on a 1x1 window and exits silently, so
   * never start until the box has a real size.
   */
  function waitForBox(timeoutMs = 4000): Promise<DOMRect | null> {
    return new Promise(resolve => {
      const deadline = performance.now() + timeoutMs
      const check = () => {
        const r = boxEl.value?.getBoundingClientRect()
        if (r && r.width >= 16 && r.height >= 16)
          resolve(r)
        else if (performance.now() > deadline)
          resolve(null)
        else
          requestAnimationFrame(check)
      }
      check()
    })
  }

  return { measure, push, readScale, reset, waitForBox }
}
