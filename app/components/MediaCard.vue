<script setup lang="ts">
import type { Media } from '~/utils/tmdb'
import { mdiBookmark, mdiBookmarkOutline, mdiCheck, mdiDotsVertical, mdiEye, mdiEyeOutline, mdiHeart, mdiHeartOutline, mdiPlay, mdiStar } from '@mdi/js'

const props = defineProps<{
  media: Media
  /** Show the title and year under the poster. */
  detail?: boolean
  /** Overrides the detail page as the destination — the resume rows play directly. */
  to?: string
}>()

const ui = useUiStore()
const library = useLibraryStore()

// The bar tracks the episode a show is up to, so it has to say which one; the
// tick is about the title as a whole, which is a different question.
const progress = computed(() => library.cardProgress(props.media))
const played = computed(() => fraction(progress.value))
const episode = computed(() => library.cardLabel(props.media))
const watched = computed(() => library.isWatched(props.media))

// A grid holds hundreds of these, and the overlay's buttons and tooltips are ~9
// Vuetify components each — mounting them per card is what made switching
// layouts stutter. Only the hovered card pays for them.
//
// Focus counts as hover: a remote has no pointer, and the overlay is what tells
// you which card you're on.
const hover = ref(false)

// The browse pages hold hundreds of cards and a TV's GPU repaints all of them,
// on screen or not — the home page scrolled at 5fps on the test set. This is the
// browser's own answer: skip layout and paint for a card that isn't visible.
// It doubled the scroll frame rate there and costs nothing on a desktop.
//
// The size is only what to reserve for a card never yet drawn — `auto` means the
// real one is remembered from then on — but it has to be close, or the scrollbar
// jumps as the guesses are replaced. Same arithmetic as the home page's
// `rowHeight`: a 2:3 poster, plus the title and year when they're shown.
//
// Not while hovered, though. The card you're pointing at is the definition of
// relevant, so skipping it saves nothing — and skipped content paints nothing at
// all. WebKitGTK (the Tauri webview on Linux) re-runs that decision while the
// poster's zoom repaints, gets it wrong for a frame or two, and the ring, badges
// and overlay all blink out mid-animation. Chromium never does, which is why it
// only shows in the app.
const reserve = computed(() =>
  `auto ${ui.cardWidth}px auto ${Math.round(ui.cardWidth * 1.5) + (props.detail ? 44 : 0)}px`)
</script>

<template>
  <nuxt-link
    :to="to ?? mediaLink(media)"
    class="group block select-none outline-none"
    :class="{ '[content-visibility:auto]': !hover }"
    :style="{ containIntrinsicSize: reserve }"
    @mouseenter="hover = true; ui.preview(media)"
    @mouseleave="hover = false"
    @focus="hover = true; ui.hover(media)"
    @blur="hover = false"
  >
    <div class="relative aspect-2/3 overflow-hidden rounded-xl bg-surface-container">
      <media-poster
        :src="posterUrl(media.poster, ui.posterSize)"
        :alt="media.title"
        class="transition-transform duration-500 group-hover:scale-105"
      />

      <!-- Inline svg rather than v-icon: this badge is on every card. No
           backdrop-blur either: it is one readback of the frame buffer per card,
           twenty of them on a screen, and at 43x20 under a 65% black fill there
           was nothing to see for it — worth a quarter of the frame rate on a TV. -->
      <div v-if="media.rating" class="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-label-small text-white">
        <svg viewBox="0 0 24 24" class="size-3 fill-amber-400"><path :d="mdiStar" /></svg>
        {{ media.rating.toFixed(1) }}
      </div>

      <!-- Watched: a filled tick opposite the rating, drawn in the accent so
           it reads as state and not as another rating. Shape as well as colour,
           because at 10 feet colour alone doesn't carry. -->
      <div v-if="watched" class="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-on-primary">
        <svg viewBox="0 0 24 24" class="size-3.5 fill-current"><path :d="mdiCheck" /></svg>
      </div>

      <transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <!-- tabindex="-1" throughout: these sit on top of the card, so a d-pad
             moving across the grid would step into them instead of the next
             card. The card itself is the target; these are pointer extras. -->
        <div v-if="hover" class="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/90 via-black/25 to-black/45">
          <div class="flex justify-end">
            <v-btn icon size="small" variant="text" color="white" tabindex="-1" @click.stop.prevent="library.toggleFavourite(media)">
              <v-icon :icon="library.isFavourite(media) ? mdiHeart : mdiHeartOutline" size="18" :color="library.isFavourite(media) ? 'primary' : undefined" />
              <v-tooltip activator="parent" :text="library.isFavourite(media) ? $t('Remove from favourites') : $t('Favourite')" />
            </v-btn>
            <v-btn icon size="small" variant="text" color="white" tabindex="-1" @click.stop.prevent="library.toggleWatchlist(media)">
              <v-icon :icon="library.inWatchlist(media) ? mdiBookmark : mdiBookmarkOutline" size="18" :color="library.inWatchlist(media) ? 'primary' : undefined" />
              <v-tooltip activator="parent" :text="library.inWatchlist(media) ? $t('Remove from watchlist') : $t('Add to watchlist')" />
            </v-btn>
            <v-btn icon size="small" variant="text" color="white" tabindex="-1" @click.stop.prevent="library.toggleWatched(media)">
              <v-icon :icon="watched ? mdiEye : mdiEyeOutline" size="18" :color="watched ? 'primary' : undefined" />
              <v-tooltip activator="parent" :text="watched ? $t('Mark unwatched') : $t('Mark watched')" />
            </v-btn>
          </div>

          <div class="grid place-items-center">
            <div class="grid size-11 place-items-center rounded-full bg-primary text-on-primary">
              <v-icon :icon="mdiPlay" size="26" />
            </div>
          </div>

          <div class="flex items-end justify-between gap-1 p-1">
            <div v-if="!detail" class="min-w-0 pb-1 pl-1 text-white">
              <div class="line-clamp-2 text-title-small">
                {{ media.title }}
              </div>
              <div class="text-body-small opacity-70">
                {{ media.year || 'unknown' }}
              </div>
            </div>
            <v-spacer v-else />
            <v-btn icon size="small" variant="text" color="white" tabindex="-1" @click.stop.prevent>
              <v-icon :icon="mdiDotsVertical" size="18" />
            </v-btn>
          </div>
        </div>
      </transition>

      <!-- How far in you got. Sits under the overlay so it survives hover, and
           only while there is something left to come back to — a finished title
           says so with the tick instead. -->
      <div v-if="played > 0 && !progress?.watched" class="absolute inset-x-0 bottom-0">
        <div v-if="episode" class="px-1.5 pb-0.5 text-label-small text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          {{ episode }}
        </div>
        <div class="h-1 bg-black/60">
          <div class="h-full bg-primary" :style="{ width: `${played * 100}%` }" />
        </div>
      </div>

      <!-- The highlight is drawn *inside* the poster. An outside ring sits
           beyond the card's box, where the scroll container it lives in clips
           it — the top row of a grid and the first card of a row lose it. -->
      <div class="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-inset ring-primary transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>

    <div v-if="detail" class="pt-2">
      <div class="truncate text-title-small">
        {{ media.title }}
      </div>
      <div class="truncate text-body-small opacity-55">
        {{ media.year || 'unknown' }}
      </div>
    </div>
  </nuxt-link>
</template>
