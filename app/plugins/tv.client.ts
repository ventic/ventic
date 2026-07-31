/**
 * What a television needs settled before anything is drawn.
 *
 * A TV reports a 960dp-wide display (1080p at density 2), so the page lays
 * itself out for a small laptop: below every `lg:` rule the desktop design is
 * built on, and at twice the size everything wants to be on a screen across the
 * room. Asking for 1280 hands the layout the width it was drawn for and shrinks
 * it to match. MainActivity turns on the wide viewport that makes this tag mean
 * anything at all — without it the WebView ignores the width outright.
 *
 * `.tv` on `<html>` is for the rest: rules that follow from there being a remote
 * and no pointer rather than from how wide the screen is.
 */
export default defineNuxtPlugin(() => {
  if (!isTv())
    return

  document.documentElement.classList.add('tv')

  // Through the head rather than the tag: Nuxt re-applies its own viewport after
  // hydration, so setting the attribute by hand is undone a moment later.
  useHead({ meta: [{ name: 'viewport', content: 'width=1280, viewport-fit=cover' }] })

  // Asking for 1280 on a 960dp screen leaves the WebView at a page scale of
  // 0.75, and Vuetify sizes its viewport as `visualViewport.width * scale` —
  // right for a pinch zoom, where the visible area really does shrink, wrong for
  // a shrink-to-fit, where the layout still fills the screen. It measured
  // 960×540 and shoved every connected overlay into the top-left three quarters
  // of the set: tooltips landed a couple of hundred pixels left of their button,
  // and menus rode up the screen. Nothing pinches on a television, so 1 is the
  // whole truth here. An own property shadows the prototype's getter.
  Object.defineProperty(visualViewport!, 'scale', { get: () => 1, configurable: true })
})
