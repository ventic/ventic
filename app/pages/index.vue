<script setup lang="ts">
import type { TmdbPage } from '~/utils/tmdb'
import { mdiBookmark, mdiBookmarkOutline, mdiHeart, mdiHeartOutline, mdiInformationOutline, mdiPlay, mdiStar } from '@mdi/js'

const ui = useUiStore()
const library = useLibraryStore()
const { smAndDown } = useDisplay()

const { data: trending } = useAsyncData(
  'home-trending',
  () => tmdb<TmdbPage>('/trending/all/day'),
  { lazy: true, transform: page => page.results.flatMap(item => toMedia(item) ?? []) },
)

/**
 * The five at the top. Backdrop art is the whole point of the panel, so a title
 * without one is passed over rather than shown as a grey box.
 */
const spotlight = computed(() => (trending.value ?? []).filter(m => m.backdrop).slice(0, 5))

const at = ref(0)
const featured = computed(() => spotlight.value[Math.min(at.value, spotlight.value.length - 1)])

// The panel carries its own art; this is the window behind it, blurred down to
// a wash — `ambient` rather than `select` so it never covers a picture the user
// set themselves.
watch(featured, media => media && ui.ambient(media), { immediate: true })

// The film's own wordmark, as its page shows it. All five are looked up and
// preloaded together, so walking the pills swaps one picture for another
// instead of flashing the plain title while each is fetched. A lookup that
// fails leaves that one title as text.
const { data: logos } = useAsyncData('home-logos', async () => {
  const entries = await Promise.all(spotlight.value.map(async m =>
    [`${m.type}${m.id}`, await titleLogo(m).catch(() => null)] as const))
  for (const [, url] of entries) {
    if (url)
      new Image().src = url
  }
  return Object.fromEntries(entries)
}, { lazy: true, watch: [spotlight] })
const logo = computed(() => featured.value && logos.value?.[`${featured.value.type}${featured.value.id}`])

// ponytail: no auto-advance. It moves the thing under a remote's focus ring,
// and it is a `useIntervalFn` plus a pause-on-focus rule away if it's missed.

const rows = computed(() => [
  { title: $t('Popular movies'), request: { path: '/movie/popular', type: 'movie' as const } },
  { title: $t('Popular shows'), request: { path: '/tv/popular', type: 'tv' as const } },
])

// Enough room for a poster row so v-lazy doesn't collapse before it mounts.
const rowHeight = computed(() => Math.round(ui.cardWidth * 1.5) + 92)
</script>

<template>
  <div class="h-full overflow-y-auto pb-10">
    <!-- The panel is its own picture rather than a hole onto the app backdrop:
         that one is off entirely in two of the three backdrop modes, and a hero
         with nothing behind it is worse than no hero. -->
    <section class="relative mx-4 mt-2 h-[42vh] min-h-64 overflow-hidden rounded-2xl bg-black/75 md:mx-6 md:h-[56vh]">
      <transition
        enter-active-class="transition-opacity duration-500"
        leave-active-class="transition-opacity duration-500"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <!-- From md up the art keeps its own 16:9 and sits right, dissolving into
             the panel's ground under the copy: stretched across a 3:1 panel it
             lost half its height, which is where the faces are. A phone is
             narrower than the picture, so there it still fills the panel. Vue
             falls back to -webkit-mask-image itself on a webview before Chrome 120. -->
        <div
          v-if="featured"
          :key="featured.id"
          class="absolute right-0 top-0 h-full w-full md:aspect-video md:w-auto md:max-w-full"
          :style="smAndDown ? undefined : { maskImage: 'linear-gradient(to right, transparent, #000 50%)' }"
        >
          <media-poster :src="backdropUrl(featured.backdrop, 'w1280')" :alt="featured.title" />
        </div>
      </transition>

      <!-- White text on somebody else's photograph: the copy needs its own
           darkness under it, in both directions, whatever the theme is doing.
           From md up the mask already is the sideways half. -->
      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent md:hidden" />

      <div v-if="featured" class="relative h-full flex flex-col justify-end gap-2 p-4 text-white md:p-6">
        <div class="flex items-center gap-2">
          <v-chip size="small" :prepend-icon="mdiStar" class="font-medium">
            {{ featured.rating.toFixed(1) }}
          </v-chip>
          <span class="text-label-medium uppercase opacity-80">
            {{ featured.type === 'movie' ? $t('Movie') : $t('TV Show') }} · {{ featured.year || $t('unknown') }}
          </span>
        </div>

        <!-- Both limits, because a wordmark is any shape: a wide one meets the
             width, a stacked one the height, and neither may push the copy up
             out of a TV's 400px panel. -->
        <img
          v-if="logo"
          :src="logo"
          :alt="featured.title"
          class="mb-1 max-h-20 max-w-[min(28rem,80%)] self-start object-contain drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] md:max-h-[18vh] xl:max-w-[36rem]"
        >
        <h1 v-else class="max-w-3xl text-headline-medium font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] md:text-display-small xl:text-display-medium">
          {{ featured.title }}
        </h1>

        <p class="line-clamp-2 max-w-2xl text-body-medium opacity-85 lg:line-clamp-4">
          {{ featured.overview }}
        </p>

        <!-- gap-y: on a phone the pills wrap under the buttons, and a bare
             gap-2 leaves them touching. Four `large` controls come to 372px,
             which is wider than a phone — so below sm they take the normal
             size, and the two icons are one element so a wrap can never leave
             a lone heart on a line of its own. -->
        <div class="flex flex-wrap items-end gap-x-2 gap-y-3 pt-1">
          <v-btn :prepend-icon="mdiPlay" :size="smAndDown ? 'default' : 'large'" :to="library.resumeLink(featured)">
            {{ $t('Play') }}
          </v-btn>
          <v-btn :prepend-icon="mdiInformationOutline" :size="smAndDown ? 'default' : 'large'" variant="tonal" color="white" :to="mediaLink(featured)">
            {{ $t('Details') }}
          </v-btn>
          <div class="flex items-center">
            <v-btn icon variant="text" color="white" :size="smAndDown ? 'default' : 'large'" @click="library.toggleWatchlist(featured)">
              <v-icon :icon="library.inWatchlist(featured) ? mdiBookmark : mdiBookmarkOutline" :color="library.inWatchlist(featured) ? 'primary' : undefined" />
              <v-tooltip activator="parent" :text="library.inWatchlist(featured) ? $t('Remove from watchlist') : $t('Add to watchlist')" />
            </v-btn>
            <v-btn icon variant="text" color="white" :size="smAndDown ? 'default' : 'large'" @click="library.toggleFavourite(featured)">
              <v-icon :icon="library.isFavourite(featured) ? mdiHeart : mdiHeartOutline" :color="library.isFavourite(featured) ? 'primary' : undefined" />
              <v-tooltip activator="parent" :text="library.isFavourite(featured) ? $t('Remove from favourites') : $t('Favourite')" />
            </v-btn>
          </div>

          <v-spacer />

          <!-- Pills, not posters: five ringed thumbnails were a second row of
               cards competing with the art. Still 40px buttons, so the d-pad
               reaches them from Play along the same row and a thumb can hit one;
               focus switches the title, and the tooltip names it for a mouse. -->
          <div class="flex">
            <button
              v-for="(media, index) in spotlight"
              :key="media.id"
              v-tooltip:top="media.title"
              type="button"
              class="group grid h-10 place-items-center rounded-full border-0 bg-transparent px-1.5"
              :aria-label="media.title"
              :aria-current="index === at"
              @click="at = index"
              @focus="at = index"
            >
              <span
                class="h-1.5 rounded-full transition-all duration-300"
                :class="index === at ? 'w-7 bg-white' : 'w-3 bg-white/40 group-hover:bg-white/75 group-focus-visible:bg-white/75'"
              />
            </button>
          </div>
        </div>
      </div>

      <div v-else class="relative h-full flex flex-col justify-end gap-3 p-4 md:p-6">
        <div class="animate-pulse h-10 max-w-md w-2/3 rounded-lg bg-surface-container/60" />
        <div class="animate-pulse h-12 max-w-2xl w-full rounded-lg bg-surface-container/60" />
      </div>
    </section>

    <div class="flex flex-col gap-7 pt-7">
      <!-- To the thing itself, not straight into playback: an episode you are
           about to start deserves the page that says what it is, with Play on
           it. A film's card already goes to its own page, which is the same
           answer. Not lazy — it comes out of localStorage, and it's the first
           thing you should see. -->
      <scroll-row v-if="library.resumeRow.length" :title="$t('Continue watching')">
        <media-card
          v-for="entry in library.resumeRow"
          :key="entry.key"
          :media="entry.media"
          :to="entry.season ? episodeLink(entry.media.id, entry.season, entry.episode) : undefined"
          :detail="ui.isDetailed"
          class="shrink-0"
          :style="{ width: ui.rowCard }"
        />
      </scroll-row>

      <!-- Only the rows in view fetch their page; the rest wait until scrolled to. -->
      <v-lazy
        v-for="row in rows"
        :key="row.title"
        :min-height="rowHeight"
        transition="fade-transition"
      >
        <media-slider :title="row.title" :request="row.request" />
      </v-lazy>
    </div>
  </div>
</template>
