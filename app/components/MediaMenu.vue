<script setup lang="ts">
import type { Media } from '~/utils/tmdb'
import { mdiBookmark, mdiBookmarkOutline, mdiEye, mdiEyeOutline, mdiHeart, mdiHeartOutline, mdiInformationOutline, mdiPlay } from '@mdi/js'

/**
 * What a card can do besides open: play, favourite, watchlist, watched. On a
 * desktop those sit on the card as hover buttons, which a finger never sees and
 * a remote can't reach (`tabindex="-1"`, so the d-pad walks the grid instead
 * of into them). So the same four are a sheet, opened by a right-click, a
 * finger held on the card, or a held OK — one `contextmenu` event for all
 * three, since the WebView fires it for a long press and MainActivity fires it
 * for a held OK (`window.__tvHold`).
 *
 * Mounted once, in the layout: `ui.menuFor` is the card that asked.
 */
const ui = useUiStore()
const library = useLibraryStore()

// The last title shown, kept while the sheet slides away — clearing `menuFor`
// is what closes it, and a sheet that empties as it leaves flickers.
const shown = ref<Media | null>(null)
// And the card that asked. Vuetify hands focus back to a dialog's activator
// when it closes, but this one has none — it is opened by a store write — so
// focus fell to nothing, and a remote's next press started again from the top
// of the page. Restored once the sheet has gone (Vuetify blurs its content on
// the way out, which would undo an earlier focus), and only if the card is
// still there: Play and Details have left the page by then.
let opener: HTMLElement | null = null
watch(() => ui.menuFor, media => {
  if (!media)
    return
  shown.value = media
  const el = document.activeElement
  opener = el instanceof HTMLElement && el !== document.body ? el : null
})

function refocus() {
  if (opener?.isConnected)
    opener.focus({ preventScroll: true })
  opener = null
}

const open = computed({
  get: () => !!ui.menuFor,
  set: (value: boolean) => {
    if (!value)
      ui.menuFor = null
  },
})

function act(fn: (media: Media) => unknown) {
  if (shown.value)
    fn(shown.value)
  open.value = false
}

const favourite = computed(() => !!shown.value && library.isFavourite(shown.value))
const listed = computed(() => !!shown.value && library.inWatchlist(shown.value))
const watched = computed(() => !!shown.value && library.isWatched(shown.value))
</script>

<template>
  <v-bottom-sheet v-model="open" @after-leave="refocus">
    <!-- Capped and centred for the same reason the filter sheet is: a phone is
         narrower than the cap, and a desktop's right-click is what opens this. -->
    <v-card v-if="shown" rounded="t-xl" class="mx-auto w-full max-w-140 pb-[var(--safe-bottom)]">
      <div class="flex items-center gap-3 px-4 pb-1 pt-4">
        <div class="aspect-2/3 w-11 shrink-0 overflow-hidden rounded-md">
          <media-poster :src="posterUrl(shown.poster, 'w154')" :alt="shown.title" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-title-medium">
            {{ shown.title }}
          </div>
          <div class="text-body-small opacity-60">
            {{ shown.type === 'movie' ? $t('Movie') : $t('TV Show') }} · {{ shown.year || $t('unknown') }}
          </div>
        </div>
      </div>

      <v-list nav class="px-2 pb-2">
        <v-list-item :prepend-icon="mdiPlay" :title="$t('Play')" :to="library.resumeLink(shown)" rounded="lg" @click="open = false" />
        <v-list-item :prepend-icon="mdiInformationOutline" :title="$t('Details')" :to="mediaLink(shown)" rounded="lg" @click="open = false" />
        <v-list-item
          :prepend-icon="favourite ? mdiHeart : mdiHeartOutline"
          :title="favourite ? $t('Remove from favourites') : $t('Favourite')"
          rounded="lg"
          @click="act(m => library.toggleFavourite(m))"
        />
        <v-list-item
          :prepend-icon="listed ? mdiBookmark : mdiBookmarkOutline"
          :title="listed ? $t('Remove from watchlist') : $t('Add to watchlist')"
          rounded="lg"
          @click="act(m => library.toggleWatchlist(m))"
        />
        <v-list-item
          :prepend-icon="watched ? mdiEye : mdiEyeOutline"
          :title="watched ? $t('Mark unwatched') : $t('Mark watched')"
          rounded="lg"
          @click="act(m => library.toggleWatched(m))"
        />
      </v-list>
    </v-card>
  </v-bottom-sheet>
</template>
