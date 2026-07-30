import type { Dir } from '~/utils/dpad'

/**
 * Remote-control navigation, app-wide.
 *
 * A TV remote sends the four arrows, OK (Enter) and Back — nothing else. Enter
 * already activates a focused link or button natively, so all this adds is:
 * arrows move focus to the nearest element that way, Back closes or goes back,
 * and focus becomes visible the moment a d-pad is used.
 *
 * It sits on `document` in the bubble phase and gives up on `defaultPrevented`,
 * so anything with its own arrow handling — Vuetify's sliders, lists and
 * selects, and the mpv player's seek keys — keeps it.
 */

const DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Dialogs, menus and selects own the screen while they're up. Tooltips are
 * overlays too but they open on focus, so counting them would trap the d-pad on
 * whichever button it just landed on.
 */
const MODAL = '.v-overlay--active:not(.v-tooltip)'

export default defineNuxtPlugin(() => {
  const router = useRouter()
  const html = document.documentElement
  let dpad = false

  /** A dialog owns the screen: without this the d-pad walks out of it into the page behind. */
  function scope(): ParentNode {
    const open = document.querySelectorAll<HTMLElement>(`${MODAL} .v-overlay__content`)
    return open[open.length - 1] ?? document
  }

  // Rects for every focusable on every press. A browse page holds a
  // few hundred, which measures in single-digit ms — bucket them by row if a
  // long infinite-scrolled grid ever gets sluggish.
  function focusables(root: ParentNode) {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => {
      if (el.tabIndex < 0)
        return false
      // A closed temporary drawer (narrow windows only) is slid off screen
      // rather than hidden, so its links would otherwise still be targets.
      if (el.closest('.v-navigation-drawer:not(.v-navigation-drawer--active)'))
        return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  }

  function show(el: HTMLElement) {
    el.focus({ preventScroll: true })
    // `nearest` keeps the row or grid it lives in from jumping any further than
    // it has to.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }

  function onScreen(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0
  }

  /**
   * Nothing focused yet (page just opened, or the page was scrolled out from
   * under it): start on the page's own content rather than the chrome above it,
   * and prefer something whole — after a scroll, the row that has just arrived
   * is a better landing than the one on its way out.
   */
  function focusFirst() {
    const root = scope()
    const start = root === document ? document.querySelector('[data-dpad-start]') : null
    const from = (parent: ParentNode) => {
      const list = focusables(parent).filter(onScreen)
      return list.find(el => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      }) ?? list[0]
    }

    const el = (start && from(start)) || from(root)
    el?.focus({ preventScroll: true })
    return !!el
  }

  function move(dir: Dir) {
    const root = scope()
    const from = document.activeElement as HTMLElement | null

    if (!from || from === document.body || !root.contains(from))
      return focusFirst()

    // Descendants stay in play (a card's own Play button is a real target);
    // ancestors don't, since their box encloses ours in every direction.
    const list = focusables(root).filter(el => el !== from && !el.contains(from))
    const at = pickDirection(from.getBoundingClientRect(), list.map(el => el.getBoundingClientRect()), dir)
    if (at < 0)
      return false

    show(list[at]!)
    return true
  }

  /**
   * Nothing to focus that way. Push the page along instead: rows below the fold
   * mount lazily (so there is literally nothing there to move to yet), and a
   * page of prose between two buttons has to be readable without one.
   */
  function nudge(dir: Dir) {
    const horizontal = dir === 'left' || dir === 'right'
    const back = dir === 'up' || dir === 'left'

    for (let el = document.activeElement ?? document.querySelector('[data-dpad-start]'); el; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (!/auto|scroll/.test(horizontal ? style.overflowX : style.overflowY))
        continue

      const at = horizontal ? el.scrollLeft : el.scrollTop
      const end = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
      // Wrung dry in that direction — keep walking up for something that isn't.
      if (back ? at < 1 : at > end - 1)
        continue

      const step = (horizontal ? el.clientWidth : el.clientHeight) * 0.8
      el.scrollBy({ [horizontal ? 'left' : 'top']: back ? -step : step, behavior: 'smooth' })
      // Whatever was focused is being scrolled away from, so let go: the next
      // press starts from the top of what's now on screen.
      ;(document.activeElement as HTMLElement | null)?.blur()
      return true
    }
    return false
  }

  /** Fires Escape and reports whether anything claimed it. */
  function escapeConsumed() {
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    return !(document.activeElement ?? document.body).dispatchEvent(escape)
  }

  /**
   * Back, in the order a remote user expects: close what's open, else leave the
   * screen. `false` means there was nothing left to go back to — Android takes
   * that as its cue to quit (see MainActivity.kt).
   */
  function back() {
    // Vuetify's dialogs, menus and selects all close themselves on Escape.
    if (document.querySelector(MODAL)) {
      escapeConsumed()
      return true
    }
    // The player claims Escape for its own menus, then for leaving playback.
    if (escapeConsumed())
      return true
    if (window.history.state?.back) {
      router.back()
      return true
    }
    return false
  }

  window.__tvBack = back

  function markDpad() {
    if (dpad)
      return
    dpad = true
    html.classList.add('dpad')
  }

  document.addEventListener('keydown', e => {
    // Whoever handled it first wanted the key: sliders, list menus, mpv's seek.
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey)
      return

    if (e.key === 'BrowserBack' || e.key === 'GoBack') {
      e.preventDefault()
      markDpad()
      back()
      return
    }

    const dir = DIRS[e.key]
    if (!dir)
      return

    // A text field keeps left/right for the caret; up/down is how you leave it.
    const el = document.activeElement
    const typing = el instanceof HTMLElement
      && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
    if (typing && (dir === 'left' || dir === 'right'))
      return

    markDpad()
    if (move(dir) || nudge(dir))
      e.preventDefault()
  })

  // Focus rings are for people driving with a d-pad; a mouse puts them away again.
  document.addEventListener('pointermove', () => {
    if (!dpad)
      return
    dpad = false
    html.classList.remove('dpad')
  }, { passive: true })

  // A new page starts with focus on nothing, which leaves a remote with no
  // origin to move from. Only once a d-pad is in use — it would steal the
  // caret from the search box otherwise.
  router.afterEach(() => {
    if (dpad)
      nextTick(focusFirst)
  })
})
