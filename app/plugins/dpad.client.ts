import type { Box, Dir, Offset } from '~/utils/dpad'
import { addPluginListener } from '@tauri-apps/api/core'

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

  /**
   * Where each scroller is heading, and the frame loop taking it there.
   *
   * Everything below is decided against these rather than against what
   * `scrollTop` says at this instant: mid-animation the DOM describes a page on
   * its way somewhere, and a press that believed it asked to go a screen too far.
   *
   * The animation is ours because the platform's cannot be retargeted. A
   * `scrollTo` with a smooth behaviour *cancels* whatever is running and eases
   * in from a standstill, so a press landing mid-scroll stopped the page dead
   * and started again — measured on the set, eight presses 120ms apart: the
   * page crawled at 5px a frame for three seconds and then covered 2000px in
   * half of one, once the presses stopped. Easing toward a moving target has no
   * standstill in it: a press only moves the target, and the speed already
   * there carries into it.
   *
   * `WeakMap`s because an entry is worth exactly as long as its element.
   */
  const heading = new WeakMap<Element, Offset>()
  /** What the loop last put there, so a wheel or a finger is noticed. */
  const written = new WeakMap<Element, Offset>()
  const moving = new Set<Element>()
  let frame = 0
  let drawn = 0

  /** `within`, asked about a real scroller — how far it has to give, each axis. */
  function reach(el: Element, to: Offset) {
    return within(to, el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth)
  }

  function step(now: number) {
    // Capped, so a dropped second's worth of frames eases rather than teleports.
    const gone = Math.min(now - drawn, 64)
    drawn = now
    frame = 0

    for (const el of [...moving]) {
      const to = heading.get(el)
      const put = written.get(el)
      // Somebody else moved it — a wheel, a finger, a component's own scroll.
      // Theirs now.
      if (!to || !put || Math.abs(el.scrollTop - put.top) > 1 || Math.abs(el.scrollLeft - put.left) > 1) {
        moving.delete(el)
        heading.delete(el)
        continue
      }
      // Re-clamped every frame, not just when aimed: a grid that has just
      // mounted another page, or dropped one, moves the end it can stop at.
      const goal = reach(el, to)
      const at = eased(put, goal, gone)
      const done = arrived(at, goal)
      el.scrollTop = done ? goal.top : at.top
      el.scrollLeft = done ? goal.left : at.left
      // Read back rather than assumed: the scroller rounds and clamps, and an
      // assumption that does not match is indistinguishable from a finger.
      written.set(el, { top: el.scrollTop, left: el.scrollLeft })
      if (done) {
        moving.delete(el)
        heading.delete(el)
      }
    }

    if (moving.size)
      frame = requestAnimationFrame(step)
  }

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
      // An inert element cannot take focus, so aiming at one is a press that
      // does nothing at all. `TvField` parks its input that way under a
      // transparent button of exactly the same size — and an exact tie goes to
      // whichever comes first in the DOM, which is the input. That is why the
      // remote could never reach "This device is called" or the pairing code.
      if (el.closest('[inert]'))
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

  /** Every box `el` is clipped to, and how far short of rest its ancestors are. */
  interface Clips { boxes: Box[], dx: number, dy: number }

  /**
   * Every scroller `el` sits inside, plus the window, as boxes — what `clipped`
   * needs to say where the element can actually be seen — and the offset that
   * turns a rect of `el`'s into the one it will have once every scroll of ours
   * has landed. A scroller still `dy` short of its destination is drawing its
   * children `dy` away from where they belong.
   *
   * Memoised on the parent chain, because a grid's few hundred candidates share
   * a handful of them and `getComputedStyle` is the expensive part.
   */
  function clips(el: Element, memo: Map<Element, Clips>): Clips {
    const parent = el.parentElement
    if (!parent)
      return { boxes: [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }], dx: 0, dy: 0 }
    const known = memo.get(parent)
    if (known)
      return known
    const above = clips(parent, memo)
    const style = getComputedStyle(parent)
    // `hidden` and `clip` cut a box off just as surely as a scroller does, and
    // a card row is both — `overflow-x: auto` makes the other axis compute to
    // `auto` too, which is exactly the clipping the row really does. The box is
    // where it will be, so it moves with whatever is scrolling *above* it but
    // not with its own scrolling, which only moves what it holds.
    const boxes = /auto|scroll|hidden|clip/.test(style.overflowX + style.overflowY)
      ? [shift(parent.getBoundingClientRect(), above.dx, above.dy), ...above.boxes]
      : above.boxes
    const at = resting(parent)
    const own = {
      boxes,
      dx: above.dx + parent.scrollLeft - at.left,
      dy: above.dy + parent.scrollTop - at.top,
    }
    memo.set(parent, own)
    return own
  }

  /** Where `el` will have come to rest, while a scroll of ours is still running. */
  function resting(el: Element) {
    return heading.get(el) ?? { top: el.scrollTop, left: el.scrollLeft }
  }

  /**
   * Aim there, and keep the loop running. Clamped to where the scroller can
   * actually stop: a destination it can never reach is one `resting` answers
   * with for ever, and every later press is then measured against a page that
   * does not exist — one nudge to the foot of a title page left everything
   * judged against a page 517px further down, and "down" off the last row of
   * More like this jumped into the sidebar.
   */
  function glide(el: Element, to: Offset) {
    const at = reach(el, to)
    heading.set(el, at)
    // Somebody who cannot bear the movement gets none of it; `scroll-behavior`
    // would have honoured this for us, and an animation of our own has to say
    // so itself.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.scrollTop = at.top
      el.scrollLeft = at.left
      heading.delete(el)
      return at
    }
    if (!moving.has(el)) {
      written.set(el, { top: el.scrollTop, left: el.scrollLeft })
      moving.add(el)
    }
    if (!frame) {
      drawn = performance.now()
      frame = requestAnimationFrame(step)
    }
    return at
  }

  /**
   * `el`'s rect as it will be once every scroll of ours has landed, with the
   * boxes it is clipped to. `move` wants both; `focusFirst` only the rect.
   */
  function settled(el: HTMLElement, memo: Map<Element, Clips>) {
    const c = clips(el, memo)
    return { box: shift(el.getBoundingClientRect(), c.dx, c.dy), boxes: c.boxes }
  }

  /** One edge of the scroll-padding. `auto`, and a percentage, read as none. */
  function padding(style: CSSStyleDeclaration, side: 'Top' | 'Bottom' | 'Left' | 'Right') {
    return Number.parseFloat(style[`scrollPadding${side}` as 'scrollPaddingTop']) || 0
  }

  function show(el: HTMLElement, memo: Map<Element, Clips>) {
    el.focus({ preventScroll: true })

    // Every scroller this sits in, innermost first, each asked how far it has to
    // move for the box to be inside it (`nearest`, in utils/dpad — and why it is
    // ours rather than `scrollIntoView`'s).
    //
    // Jumping the scrollers to where they were heading and back first did fix
    // the destination, and was worse: **writing `scrollTop` cancels a running
    // smooth scroll**, so every press restarted the animation from a standstill
    // instead of letting Chromium retarget the one already running. Measured on
    // the set, eight presses 120ms apart — the page crawled at 5px a frame for
    // three seconds and then flew 2000px in half of one. Easing toward a moving
    // target has no standstill in it, which is what `glide` does instead.
    let box = settled(el, memo).box
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p)
      const down = /auto|scroll/.test(style.overflowY) && p.scrollHeight > p.clientHeight
      const across = /auto|scroll/.test(style.overflowX) && p.scrollWidth > p.clientWidth
      if (!down && !across)
        continue

      // Its client box at rest: the border is outside what scrolls, and the
      // rect is not.
      const own = clips(p, memo)
      const r = shift(p.getBoundingClientRect(), own.dx, own.dy)
      const left = r.left + p.clientLeft
      const top = r.top + p.clientTop
      const dy = down ? nearest(box.top, box.bottom, top + padding(style, 'Top'), top + p.clientHeight - padding(style, 'Bottom')) : 0
      const dx = across ? nearest(box.left, box.right, left + padding(style, 'Left'), left + p.clientWidth - padding(style, 'Right')) : 0
      if (!dx && !dy)
        continue

      // `glide` clamps to where the scroller can stop, so what the box really
      // moves by is what came back — and it is the moved box the next scroller
      // out has to be asked about.
      const at = resting(p)
      const to = glide(p, { top: at.top + dy, left: at.left + dx })
      box = shift(box, at.left - to.left, at.top - to.top)
    }
  }

  function onScreen(r: Box) {
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
    // Where the page is *going*, not where it is: this runs a press after a
    // `nudge` let focus go, with that scroll still animating, and the live page
    // offers a row on its way off the screen. Landing on one and moving from it
    // walked the grid backwards.
    const memo = new Map<Element, Clips>()
    const from = (parent: ParentNode) => {
      const list = focusables(parent)
        .map(el => [el, settled(el, memo).box] as const)
        .filter(([, box]) => onScreen(box))
      return (list.find(([, box]) => box.top >= 0 && box.bottom <= window.innerHeight) ?? list[0])?.[0]
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
    // Measured as the page will be once it has settled, never as it is
    // mid-animation: while a scroll runs, every row below the fold is clipped
    // onto the same edge and only document order tells them apart — so a
    // second press in a burst could pick a row *above* the one it came from
    // and walk the grid backwards.
    const memo = new Map<Element, Clips>()
    const seen = (el: HTMLElement) => {
      const { box, boxes } = settled(el, memo)
      return clipped(box, boxes)
    }
    const at = pickDirection(seen(from), list.map(seen), dir)
    if (at < 0)
      return false

    // A press that would leave a region still holding content that way scrolls
    // it instead. A title page's synopsis is prose, so nothing above the buttons
    // is a target at all and up escaped straight to the toolbar — which left the
    // title, the poster and the overview unreachable for the rest of the visit,
    // there being nothing to move *to* that would bring them back.
    const region = scroller(from, dir)
    if (region && !region.contains(list[at]!))
      return false

    show(list[at]!, memo)
    return true
  }

  /**
   * The nearest thing around `el` with somewhere left to go that way, if any.
   * Wrung dry in that direction doesn't count — keep walking up for something
   * that isn't.
   */
  function scroller(el: Element | null, dir: Dir) {
    const horizontal = dir === 'left' || dir === 'right'
    const back = dir === 'up' || dir === 'left'

    for (; el; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (!/auto|scroll/.test(horizontal ? style.overflowX : style.overflowY))
        continue

      const to = resting(el)
      const at = horizontal ? to.left : to.top
      const end = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
      if (back ? at > 1 : at < end - 1)
        return el as HTMLElement
    }
    return null
  }

  /**
   * Nothing to focus that way. Push the page along instead: rows below the fold
   * mount lazily (so there is literally nothing there to move to yet), and a
   * page of prose between two buttons has to be readable without one.
   */
  function nudge(dir: Dir) {
    const el = scroller(document.activeElement ?? document.querySelector('[data-dpad-start]'), dir)
    if (!el)
      return false

    const horizontal = dir === 'left' || dir === 'right'
    const back = dir === 'up' || dir === 'left'
    // A screen on from where it is *heading*, so a second press during the
    // first one's animation moves a second screen rather than re-asking for
    // most of the first.
    const at = resting(el)
    const step = (horizontal ? el.clientWidth : el.clientHeight) * 0.8 * (back ? -1 : 1)
    const was = (document.activeElement as HTMLElement | null)?.getBoundingClientRect()
    const to = glide(el, { top: at.top + (horizontal ? 0 : step), left: at.left + (horizontal ? step : 0) })
    // How far the page moves from where it is *now* — and from where it will
    // really stop, not where we asked for, or a press into the last half-screen
    // of a page would drop focus that never went anywhere. That is what decides
    // whether what has focus is on its way off the screen.
    const by = horizontal ? to.left - el.scrollLeft : to.top - el.scrollTop

    // Whatever was focused is being scrolled away from, so let go: the next
    // press starts from the top of what's now on screen. Only where it really
    // has gone, though — the page moves under it by `by`, and on a title page,
    // where the prose is what scrolls and the buttons stay put, dropping focus
    // costs a press and reveals nothing.
    const box = el.getBoundingClientRect()
    const stays = was && (horizontal
      ? was.left - by < box.right && was.right - by > box.left
      : was.top - by < box.bottom && was.bottom - by > box.top)
    if (!stays)
      (document.activeElement as HTMLElement | null)?.blur()
    return true
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
   * Android hands BACK to the page only once the page asks for it. Tauri's own
   * `AppPlugin` holds the top of the activity's back dispatcher — registered
   * after MainActivity's, so it runs first — and with no listener for its
   * `back-button` event it pops the WebView's history itself whenever there is
   * any, falling through to MainActivity only at the root. That is why BACK
   * closed a dialog on the home page and left a film with the subtitle panel
   * still open: mid-history, the page was never asked. With a listener the
   * plugin triggers this instead and pops nothing, so every BACK — a remote's
   * key and a phone's gesture alike — is `back()`'s to answer. Nothing left to
   * close or go back to means the app goes behind whatever is next, which is
   * what MainActivity does for the one press that can arrive before this
   * listener exists (see `backToPage` there).
   */
  if (onAndroid()) {
    addPluginListener('app', 'back-button', () => {
      markDpad()
      if (!back())
        backgroundApp()
    }).catch(() => {})
  }

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
   * A held OK — the remote's long press. It becomes the `contextmenu` a
   * right-click and a finger held on a card already are, on whatever has focus,
   * so a card answers all three with one handler (see MediaMenu). MainActivity
   * only ever sends it after keeping the press itself back — the WebView clicks
   * a focused link on the key's way *down*, so an OK it had seen would already
   * have opened the card under the sheet. `true` when something claimed it.
   */
  window.__tvHold = () => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || el === document.body)
      return false
    markDpad()
    return !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  }

  /**
   * Is a caret in play? A readonly field has no caret to keep — Vuetify builds
   * its selects out of an `<input readonly>`, and treating that as typing is
   * what left a remote unable to move sideways off a dropdown at all. Nor does
   * a checkbox, which is what every `v-checkbox` and `v-switch` focuses: read
   * as a field, the Add button beside the Xtream form's "Show password" could
   * not be reached from it.
   */
  function typing() {
    const el = document.activeElement
    return el instanceof HTMLElement
      && (el.isContentEditable
        || ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
          && !(el as HTMLInputElement).readOnly
          && !['checkbox', 'radio'].includes((el as HTMLInputElement).type)))
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
