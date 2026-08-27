<script setup lang="ts">
import type { Channel } from '~/utils/iptv'
import { mdiHeart, mdiHeartOutline, mdiTelevisionPlay } from '@mdi/js'

const props = defineProps<{ channel: Channel }>()

const ui = useUiStore()
const library = useLibraryStore()

/**
 * Straight into the player, since a channel has no page to land on: no cast, no
 * overview, no episodes, and no TMDB record behind it. `url` is the same query
 * `watch.vue` already plays a debrid link with — no engine, no disk, no swarm.
 */
const to = computed(() => ({
  path: localePath('/watch'),
  query: { url: props.channel.url, title: props.channel.name, live: 1 },
}))

const favourite = computed(() => library.isChannelFavourite(props.channel.name))

// Same reason MediaCard mounts its overlay only while hovered: a grid holds
// hundreds of these and the button plus its tooltip is a handful of Vuetify
// components each. Focus counts as hover — a remote has no pointer, and this is
// what says which card you are on.
const hover = ref(false)

// The same reason MediaCard carries it, more so: a playlist is thousands of
// tiles and a TV paints every one of them, on screen or not. 16:9 rather than
// 2:3 — a channel has a logo, not a poster.
const reserve = computed(() => `${ui.cardWidth}px ${Math.round(ui.cardWidth * 0.5625)}px`)
</script>

<template>
  <nuxt-link
    :to="to"
    class="group block select-none outline-none"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
    @focus="hover = true"
    @blur="hover = false"
  >
    <div class="relative aspect-video overflow-hidden rounded-xl bg-surface-container">
      <!-- `contain`: a channel logo is any shape at all, and cropping one is
           how a broadcaster's name gets cut in half. -->
      <media-poster
        :src="channel.logo || null"
        :alt="channel.name"
        :icon="mdiTelevisionPlay"
        contain
        class="[content-visibility:auto]"
        :style="{ containIntrinsicSize: reserve }"
      />

      <!-- Always drawn once set, and not only on hover: this is what "sorted to
           the top" means when you are looking at the top of the list. Shape as
           well as colour — at ten feet a tinted heart is just a heart. -->
      <div
        v-if="favourite"
        class="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-on-primary"
      >
        <svg viewBox="0 0 24 24" class="size-3 fill-current"><path :d="mdiHeart" /></svg>
      </div>

      <transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <!-- tabindex="-1", exactly as on MediaCard: this sits on top of the
             card, so a d-pad crossing the grid would step into it instead of
             the next channel. The card is the target; this is a pointer extra. -->
        <div v-if="hover" class="absolute inset-0 flex justify-end bg-gradient-to-b from-black/70 to-transparent">
          <v-btn
            icon
            size="small"
            variant="text"
            color="white"
            tabindex="-1"
            @click.stop.prevent="library.toggleChannelFavourite(channel.name)"
          >
            <v-icon :icon="favourite ? mdiHeart : mdiHeartOutline" size="18" :color="favourite ? 'primary' : undefined" />
            <v-tooltip activator="parent" :text="favourite ? $t('Remove from favourites') : $t('Favourite')" />
          </v-btn>
        </div>
      </transition>

      <div class="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-inset ring-primary transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>

    <div class="pt-2">
      <div class="truncate text-title-small">
        {{ channel.name }}
      </div>
      <div class="truncate text-body-small opacity-55">
        {{ channel.group || $t('Live TV') }}
      </div>
    </div>
  </nuxt-link>
</template>
