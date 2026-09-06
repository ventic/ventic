import type { BackdropMode } from '~/theme/presets'
import type { Media } from '~/utils/tmdb'
import { mdiBookmarkOutline, mdiFormatListBulleted, mdiHeartOutline, mdiHistory, mdiViewGrid } from '@mdi/js'

// 'grid-detail' is the only grid now — kept as the value (not renamed to 'grid')
// so `isDetailed` still reads true for it and the home sliders stay detailed.
export type Layout = 'grid-detail' | 'list'

/** Poster art, one picture the user chose, or nothing at all — a theme names one. */
export type { BackdropMode }

// `title` is a function for the same reason SECTIONS' is — see the settings
// store: built at module load, before `$t` has a locale to read.
export const BACKDROP_MODES: { value: BackdropMode, title: () => string }[] = [
  { value: 'art', title: () => $t('Poster art') },
  { value: 'custom', title: () => $t('My own image') },
  { value: 'off', title: () => $t('None') },
]

// `title` is a function for the same reason SECTIONS' is — see the settings
// store: built at module load, before `$t` has a locale to read.
export const LAYOUTS: { value: Layout, title: () => string, icon: string }[] = [
  { value: 'grid-detail', title: () => $t('Grid'), icon: mdiViewGrid },
  { value: 'list', title: () => $t('List'), icon: mdiFormatListBulleted },
]

/**
 * The three lists the library is made of, in the order the sidebar shows
 * them. A table because three places list the same three — the sidebar, the
 * phone's Library tab, and the switcher on the pages themselves — and `value`
 * is both the route and its name. `title` is a function for the same reason
 * SECTIONS' is (see the settings store).
 */
export const LIBRARY_LISTS: { value: string, title: () => string, icon: string }[] = [
  { value: 'favourites', title: () => $t('Favourites'), icon: mdiHeartOutline },
  { value: 'watchlist', title: () => $t('Watchlist'), icon: mdiBookmarkOutline },
  { value: 'history', title: () => $t('History'), icon: mdiHistory },
]

// One layout/size preference shared by every browse page instead of
// per-page copies. Split it if the pages ever need to disagree.
export const useUiStore = defineStore('ui', () => {
  const layout = useLocalStorage<Layout>('ventic.layout', 'grid-detail')
  // Retired layouts map onto what replaced them so a mandatory toggle never
  // lands on a value it can no longer show: the detailed list became 'list',
  // and the plain grid was folded into the (now only) detailed grid.
  if (layout.value as string === 'list-detail')
    layout.value = 'list'
  if (layout.value as string === 'grid')
    layout.value = 'grid-detail'
  const cardWidth = useLocalStorage('ventic.cardWidth', 170)
  /** The faces in a Cast row. Its own setting: a headshot is read at a size a poster isn't. */
  const castWidth = useLocalStorage('ventic.castWidth', 140)
  /** Desktop: collapsed icon-only sidebar. */
  const rail = useLocalStorage('ventic.rail', false)
  /** Mobile: the section drawers (transfers, settings) are overlays, so they need an open/closed state. */
  const drawer = ref(false)

  /**
   * The title whose action sheet is up — see MediaMenu. A card sets it on a
   * right-click, on a finger held on it, and on a held OK from a remote; the
   * sheet puts it back to null. One sheet for the whole app rather than one
   * per card, because a grid holds hundreds of cards.
   */
  const menuFor = ref<Media | null>(null)

  /**
   * A source URL that arrived on a `ventic://` link and is waiting to be
   * confirmed. Deliberately not persisted and never added on its own: a link
   * from a web page may not silently change what the app searches.
   */
  const pendingSource = ref('')

  const blur = useLocalStorage('ventic.blur', 44)
  const tint = useLocalStorage('ventic.tint', 0.92)

  /** Where the art behind the app comes from, if anywhere. */
  const backdropMode = useLocalStorage<BackdropMode>('ventic.backdropMode', 'art')
  /** The user's own picture, already downscaled — see `pages/settings/appearance/background.vue`. */
  const backdropImage = useLocalStorage('ventic.backdropImage', '')
  /**
   * Whether pointing at or focusing a card swaps the art, rather than only
   * opening a title. Off by default: sweeping a grid otherwise repaints the
   * whole window per card, which reads as flicker more than as preview.
   */
  const backdropFollowsHover = useLocalStorage('ventic.backdropHover', false)
  /**
   * With a picture of your own set, whether artwork still takes over while
   * you're on a title. The picture is then what the app rests on — and, with
   * "take the colour from what's on screen", what the palette comes from
   * everywhere the artwork isn't.
   */
  const artOverCustom = useLocalStorage('ventic.backdropArtOverCustom', true)
  /**
   * The picture actually painted and the source colour read off it, published
   * as one value by `AppBackground` once the picture has decoded. The two are
   * never apart: a colour belongs to the picture it was read from, and the
   * backdrop moves to a new title well before that picture is on screen.
   */
  const shownArt = ref({ url: '', colour: '' })

  /** What the cursor or focus is on — the home page's hero reads this. */
  const selected = ref<Media | null>(null)
  /** What the backdrop paints. The same thing only when hover is allowed to move it. */
  const art = ref<Media | null>(null)
  /**
   * The last art a list brought with it, kept so closing a title has something
   * to fall back to — otherwise a film you looked at once keeps colouring every
   * page you visit afterwards.
   */
  const ambientArt = ref<Media | null>(null)
  /**
   * Whether that art is a title the user went to rather than whichever row a
   * browse page happened to open on. Only the former is worth painting over a
   * picture the user chose themselves.
   */
  const picked = ref(false)

  const backdrop = computed(() => backdropFor(
    backdropMode.value,
    art.value?.backdrop,
    backdropImage.value,
    artOverCustom.value && picked.value,
  ))

  // Every card is cardWidth wide, so one bucket serves the whole grid — a 110px
  // card has no use for the 342px art. Ratio is reactive: the window can move
  // to a monitor with a different density.
  const { pixelRatio } = useDevicePixelRatio()
  const posterSize = computed(() => posterFor(cardWidth.value * pixelRatio.value))
  // TMDB has no bucket between the two, so a face wider than w185 device pixels
  // takes h632 rather than being upscaled — which is the whole point of enlarging it.
  const profileSize = computed(() => castWidth.value * pixelRatio.value > 185 ? 'h632' as const : 'w185' as const)

  /**
   * Every grid of cards. The poster size, but never wider than half the grid:
   * two to a row is the floor, because one poster to a row is a list with the
   * words missing. The 8px is half the 16px gap — at a flat 50% the second
   * column no longer fits beside the gap and auto-fill drops to one. It is a
   * ceiling on the *cap*, not on the setting: a cap of a fixed 30% was three
   * across whatever the poster size said, which left the size control doing
   * nothing at all on a phone.
   */
  const gridColumns = computed(() => `repeat(auto-fill, minmax(min(${cardWidth.value}px, 50% - 8px), 1fr))`)

  /**
   * A card's width in a row: the poster size, under the same two-to-a-phone
   * cap `gridColumns` puts on the grid, so a row and a grid show the same
   * posters at the same size on the same phone. Wider than that, it is the
   * poster size unchanged.
   */
  const rowCard = computed(() => `min(${cardWidth.value}px, 50vw - 8px)`)

  const isGrid = computed(() => layout.value.startsWith('grid'))
  const isDetailed = computed(() => layout.value.endsWith('detail'))

  /**
   * Opening a title: this is the art the backdrop is *about*, so it always
   * paints. Titles with no backdrop are ignored rather than blanking the window
   * — the previous art is a better background than a flat colour.
   *
   * Returns a token to hand back to `release` on the way out.
   */
  let turn = 0
  function select(media: Media | null) {
    if (media?.backdrop || !media) {
      selected.value = media
      art.value = media
      picked.value = true
    }
    return ++turn
  }

  /**
   * The art a list brings with it, rather than a title the user opened — the
   * first row of a page they scrolled onto. Paints the same in "Poster art",
   * but never covers the user's own picture.
   */
  function ambient(media: Media | null) {
    select(media)
    ambientArt.value = media
    picked.value = false
  }

  /**
   * Closing a title: back to the art of whatever page is behind it. Takes the
   * token `select` gave out, because leaving one title for another unmounts the
   * old page around the new one's mount, in an order nothing here should depend
   * on — and a show, its season and its episode all select the same media, so
   * comparing that wouldn't tell them apart. Only the page that set the art
   * still holds the current token, and only it can clear it.
   */
  function release(token: number) {
    if (token !== turn)
      return
    selected.value = ambientArt.value
    art.value = ambientArt.value
    picked.value = false
  }

  /**
   * Pointing at or focusing a card. Always moves what the page considers
   * current — the home hero follows the cursor either way — but only repaints
   * the window when the user asked for that.
   */
  function hover(media: Media | null) {
    if (media?.backdrop || !media) {
      selected.value = media
      if (backdropFollowsHover.value) {
        art.value = media
        picked.value = true
      }
    }
  }

  // Sweeping the cursor across a grid would otherwise queue a crossfade per card.
  const preview = useDebounceFn(hover, 120)

  return { layout, cardWidth, castWidth, gridColumns, rowCard, posterSize, profileSize, rail, drawer, menuFor, pendingSource, blur, tint, backdropMode, backdropImage, backdropFollowsHover, artOverCustom, shownArt, selected, art, backdrop, isGrid, isDetailed, select, ambient, release, hover, preview }
})
