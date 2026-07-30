import type { Media } from '~/utils/tmdb'
import { mdiFormatListBulleted, mdiViewGrid } from '@mdi/js'

// 'grid-detail' is the only grid now — kept as the value (not renamed to 'grid')
// so `isDetailed` still reads true for it and the home sliders stay detailed.
export type Layout = 'grid-detail' | 'list'

export const LAYOUTS: { value: Layout, title: string, icon: string }[] = [
  { value: 'grid-detail', title: 'Grid', icon: mdiViewGrid },
  { value: 'list', title: 'List', icon: mdiFormatListBulleted },
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
  /** Desktop: collapsed icon-only sidebar. */
  const rail = useLocalStorage('ventic.rail', false)
  /** Mobile: the sidebar is an overlay, so it needs an open/closed state. */
  const drawer = ref(false)

  /**
   * A source URL that arrived on a `ventic://` link and is waiting to be
   * confirmed. Deliberately not persisted and never added on its own: a link
   * from a web page may not silently change what the app searches.
   */
  const pendingSource = ref('')

  const blur = useLocalStorage('ventic.blur', 28)
  const tint = useLocalStorage('ventic.tint', 0.82)

  const selected = ref<Media | null>(null)
  const backdrop = computed(() => backdropUrl(selected.value?.backdrop, 'w1280'))

  // Every card is cardWidth wide, so one bucket serves the whole grid — a 110px
  // card has no use for the 342px art. Ratio is reactive: the window can move
  // to a monitor with a different density.
  const { pixelRatio } = useDevicePixelRatio()
  const posterSize = computed(() => posterFor(cardWidth.value * pixelRatio.value))

  const isGrid = computed(() => layout.value.startsWith('grid'))
  const isDetailed = computed(() => layout.value.endsWith('detail'))

  /**
   * Whatever art the backdrop should show. Cards call this on hover.
   * Titles with no backdrop are ignored rather than blanking the window — the
   * previous art is a better background than a flat colour.
   */
  function select(media: Media | null) {
    if (media?.backdrop || !media)
      selected.value = media
  }

  // Sweeping the cursor across a grid would otherwise queue a crossfade per card.
  const preview = useDebounceFn(select, 120)

  return { layout, cardWidth, posterSize, rail, drawer, pendingSource, blur, tint, selected, backdrop, isGrid, isDetailed, select, preview }
})
