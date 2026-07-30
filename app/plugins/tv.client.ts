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
})
