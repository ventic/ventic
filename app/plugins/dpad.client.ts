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
 * Actionable in its own right, as opposed to a focusable box that exists to hold
 * other targets. The difference decides both which candidates survive
 * `focusables()` and whether focus is somewhere a direction means anything.
 */
const ACTIONABLE = 'a[href], button, input, select, textarea'

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
    // A panel that owns the screen without being an overlay. The player's track
    // and subtitle menus can't be Vuetify dialogs — they are holes cut out of a
    // native window — and without this the first press past their last row left
    // for the bottom bar, so the rest of a menu taller than the panel could
    // never be scrolled to. Back closes them, exactly as it closes a dialog.
    return open[open.length - 1] ?? document.querySelector('[data-dpad-scope]') ?? document
  }

  // Rects for every focusable on every press. A browse page holds a
  // few hundred, which measures in single-digit ms — bucket them by row if a
  // long infinite-scrolled grid ever gets sluggish.
  function focusables(root: ParentNode) {
    const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => {
      // Only the documented -1 means "not a target" (see the card overlays).
      // Vuetify's lists rove the tabindex across their items and park -2 on the
      // ones that aren't current — which is every drawer link, all of which are
      // perfectly good places for a remote to land.
      //
      // A slide group (tabs, chip rows) roves the same way but parks a real -1,
      // so every tab but the open one looked like an opt-out: the group appeared
      // to hold a single item, `trapped` read that as "already at the end" and
      // took left/right away from the component that would have moved between
      // them — which is why Appearance could never reach Background or Display.
      if (el.getAttribute('tabindex') === '-1' && !el.parentElement?.classList.contains('v-slide-group__content'))
        return false
      // A closed temporary drawer (narrow windows only) is slid off screen
      // rather than hidden, so its links would otherwise still be targets.
      if (el.closest('.v-navigation-drawer:not(.v-navigation-drawer--active)'))
        return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })

    // A wrapper that exists to hold other targets is not one itself: Vuetify's
    // list is focusable *and* encloses every item in it, so a d-pad leaving the
    // grid landed on the list rather than a link, and the list handed focus to
    // its own idea of "first" — which is why coming back from the posters always
    // arrived at Home. Anything actionable in its own right stays, even when it
    // contains a control (an episode row owns its Play button; both are targets).
    // Descendants follow their container in document order, so the candidate
    // right after this one is the only one that can be inside it.
    return list.filter((el, i) => {
      const next = list[i + 1]
      return !next || !el.contains(next) || el.matches(ACTIONABLE)
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
    // The last marker, not the first: the layout wraps the whole page in one so
    // focus starts below the toolbar, and a page that knows better (the browse
    // grid) marks the content itself. A nested marker comes after its wrapper in
    // document order, so the innermost one wins and a page with none falls back
    // to the layout's.
    const start = root === document ? [...document.querySelectorAll('[data-dpad-start]')].pop() : null
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

    const all = focusables(root)

    // Focus can be sitting on a container rather than on a control: Vuetify
    // parks it on a dialog's `.v-overlay__content` as the dialog opens, and that
    // box encloses every button in it — so nothing lies in any direction, no
    // arrow moves anything, and the only way out of a Remove or a Sources dialog
    // is Back. Hand those presses to `focusFirst`, which lands inside the dialog
    // exactly as it does on a fresh page. Being a wrapper is the whole test: an
    // episode row is a button that owns a Play button and is a fine place to
    // move from, which is the same distinction `focusables` draws above.
    if (!from.matches(ACTIONABLE) && all.some(el => el !== from && from.contains(el)))
      return focusFirst()

    // Descendants stay in play (a card's own Play button is a real target);
    // ancestors don't, since their box encloses ours in every direction.
    const list = all.filter(el => el !== from && !el.contains(from))
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

  /**
   * Controls that answer the arrows themselves and never let go.
   *
   * A slider spends all four on its value, so up and down don't leave it — they
   * resize the posters on the way out and you're still on the slider; Back was
   * the only exit. A Vuetify list walks its items with up and down, and a slide
   * group (the category chips, tabs) walks its own with left and right — both
   * right, and both wrap from the last item back to the first, so a remote in
   * the drawer cycles Home → History → Home for ever, and one on the chips
   * circles Popular → In cinemas → Popular instead of reaching the genre filter
   * sitting beside them.
   *
   * All three keep the axis they need and give up the one that leads out: a
   * slider's value is left/right, a list's cursor is up/down and a group's is
   * left/right, each until it runs out of items. This has to be decided before
   * the component sees the key, so it runs in the capture phase — by the bubble
   * phase the value has already moved.
   */
  function trapped(el: Element | null, dir: Dir) {
    if (!(el instanceof HTMLElement))
      return false

    const vertical = dir === 'up' || dir === 'down'
    if (el.getAttribute('role') === 'slider')
      return vertical

    // A shut dropdown has nothing to navigate, yet it answers every arrow:
    // down opens it (a remote needs down to get past it to the page) and
    // left/right are swallowed to stop a caret that a readonly field hasn't
    // got — which left the d-pad unable to move sideways off it at all. Once
    // open, the arrows are the menu's.
    if (el.getAttribute('role') === 'combobox')
      return el.getAttribute('aria-expanded') !== 'true'

    const group = el.closest(vertical ? '.v-list' : '.v-slide-group')
    if (!group)
      return false
    const items = focusables(group)
    return el === items[dir === 'up' || dir === 'left' ? 0 : items.length - 1]
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

  /**
   * OK, for the one control the key never reaches. A TV's DPAD_CENTER becomes a
   * click on a link or a button, but the readonly `<input>` behind a Vuetify
   * select gets nothing — so a shut dropdown ignored OK entirely and only down
   * would open it, which is the key needed for getting past it to the page.
   * MainActivity calls this first and passes the key on either way, so `false`
   * leaves every other control working exactly as it did.
   */
  window.__tvOk = () => {
    const el = document.activeElement
    if (el?.getAttribute('role') !== 'combobox' || el.getAttribute('aria-expanded') === 'true')
      return false
    markDpad()
    // The whole pointer sequence, because Vuetify opens a select on mousedown —
    // a bare click() on the field does nothing at all.
    const field = el.closest<HTMLElement>('.v-field')
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      field?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    return true
  }

  /**
   * Is a caret in play? A readonly field has no caret to keep — Vuetify builds
   * its selects out of an `<input readonly>`, and treating that as typing is
   * what left a remote unable to move sideways off a dropdown at all.
   */
  function typing() {
    const el = document.activeElement
    return el instanceof HTMLElement
      && (el.isContentEditable
        || ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !(el as HTMLInputElement).readOnly))
  }

  function markDpad() {
    if (dpad)
      return
    dpad = true
    html.classList.add('dpad')
  }

  function handle(dir: Dir, e: KeyboardEvent) {
    markDpad()
    move(dir) || nudge(dir)
    // Ours either way. Android's WebView does its own d-pad navigation with a
    // focus model looser than the DOM's, so a key we move nothing for and leave
    // unclaimed lands focus on things that aren't targets at all — an
    // aria-hidden icon beside the poster slider, in the case that found this.
    // Nothing that way should mean nothing happens.
    e.preventDefault()
  }

  // Ahead of the components, for the keys they'd otherwise swallow whole.
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey)
      return
    const dir = DIRS[e.key]
    if (!dir)
      return
    // An arrow means a remote is in use whoever ends up acting on it. Leaving
    // this to the mover missed every key a component claimed first, so walking
    // the drawer drew no focus ring and arriving on a page left focus where it
    // was instead of on the first card.
    markDpad()
    if (!trapped(document.activeElement, dir))
      return
    // The control never gets the key, so it can't spend it on itself.
    e.stopPropagation()
    handle(dir, e)
  }, true)

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
    if (typing() && (dir === 'left' || dir === 'right'))
      return

    handle(dir, e)
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
  //
  // The route arrives before the page's content does: a browse grid is still
  // fetching for a few hundred ms, and landing during that window finds the
  // marked region empty and settles for the toolbar above it — which is how
  // opening Movies used to leave focus on the sort dropdown. Give the content a
  // moment to show up, then take the first card; a page that stays empty (an
  // empty watchlist) just keeps the focus it had.
  router.afterEach(() => {
    // Not over someone's shoulder while they type: the search box navigates a
    // few keystrokes in, and taking focus to the first result mid-word shuts the
    // on-screen keyboard and loses the rest of the query.
    if (!dpad || typing())
      return
    let tries = 12
    const land = () => {
      const start = [...document.querySelectorAll('[data-dpad-start]')].pop()
      if (start && !focusables(start).length && tries-- > 0)
        setTimeout(land, 50)
      else
        focusFirst()
    }
    nextTick(land)
  })
})
