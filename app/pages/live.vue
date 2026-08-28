<script setup lang="ts">
import { mdiAlertCircleOutline, mdiPlaylistPlus, mdiRefresh, mdiTelevisionPlay } from '@mdi/js'

/**
 * Live TV: every channel the configured playlists name, filtered down to the
 * one you want.
 *
 * There is no detail page and no TMDB behind any of this — a channel is a name
 * and a URL (see utils/iptv), and a card links straight into the player. The
 * browse pages' shape is kept (an options bar, then a grid that scrolls itself)
 * so a remote behaves here exactly as it does everywhere else.
 */
// Kept alive so opening a channel and coming back lands you where you were —
// same search, same category, same scroll. Exactly what the browse pages do.
definePageMeta({ keepalive: true })

const settings = useSettingsStore()
const ui = useUiStore()
const library = useLibraryStore()

const query = ref('')
const group = ref<string | null>(null)

/**
 * A playlist is tens of thousands of channels and every card is a DOM subtree.
 * `content-visibility` keeps a mounted card off the GPU, but the nodes still
 * cost style and layout — so the list is also cut to a window that grows as you
 * reach the end of it, which is what the browse feeds do with a page of TMDB.
 */
const PAGE = 120
const shown = ref(PAGE)

/**
 * `refresh()` on its own re-runs the handler and is handed the very same list
 * back: the playlist is fetched once per session on purpose (see
 * `loadChannels`), which is exactly what the button beside this exists to go
 * past. So the one press that means "ask the panel again" says so.
 */
let again = false

const { data, pending, error, refresh } = useAsyncData(
  'live-channels',
  () => {
    const fresh = again
    again = false
    return loadChannels(settings.playlists, fresh)
  },
  { lazy: true, default: () => [], watch: [() => settings.playlists.join('\n')] },
)

function reload() {
  again = true
  return refresh()
}

const groups = computed(() => channelGroups(data.value))

const matches = computed(() => {
  const found = filterChannels(data.value, query.value, group.value ?? '')
  // Nothing starred is the common case, and it is also the case that must not
  // pay for a sort of ten thousand channels on every keystroke.
  if (!Object.keys(library.favouriteChannels).length)
    return found
  // Favourites first, everything else in playlist order — Array#sort is stable,
  // so neither group is shuffled within itself.
  return [...found].sort((a, b) =>
    Number(library.isChannelFavourite(b.name)) - Number(library.isChannelFavourite(a.name)))
})

const visible = computed(() => matches.value.slice(0, shown.value))

const scroller = ref<HTMLElement | null>(null)

useInfiniteScroll(scroller, () => {
  shown.value += PAGE
}, {
  distance: 900,
  canLoadMore: () => shown.value < matches.value.length,
})

// Narrowing the list starts it again from the top, or the window from the last
// filter is scrolled past the whole of this one.
watch([query, group], () => {
  shown.value = PAGE
  scroller.value?.scrollTo({ top: 0 })
})

// KeepAlive parks the DOM off-document and a detached element loses its
// scrollTop, so it is recorded as it happens — by the time onDeactivated runs
// the move has already zeroed it. (MediaLayout does the same, for the same
// reason.)
let at = 0
useEventListener(scroller, 'scroll', () => {
  at = scroller.value?.scrollTop ?? at
})
onActivated(() => scroller.value?.scrollTo({ top: at }))

const failure = computed(() => error.value ? String(error.value.message ?? error.value) : '')
</script>

<template>
  <div class="flex h-full flex-col">
    <options-bar :active="group ? 1 : 0" :needs="560">
      <!-- The field a d-pad walks past rather than falls into — see
           SearchField. With ten thousand channels it is the only way to find
           one, so it leads. -->
      <search-field v-model="query" :placeholder="$t('Search channels')" class="w-full md:w-72" />

      <template #filters>
        <v-select
          v-model="group"
          :items="groups"
          :label="$t('Category')"
          clearable
          class="w-52 shrink-0"
        />
        <v-btn icon variant="text" density="comfortable" :loading="pending" @click="reload()">
          <v-icon :icon="mdiRefresh" />
          <v-tooltip activator="parent" :text="$t('Reload playlists')" />
        </v-btn>
      </template>
    </options-bar>

    <div ref="scroller" data-dpad-start class="min-h-0 flex-1 scroll-py-6 overflow-y-auto px-4 pb-10 pt-1 md:px-6">
      <!-- Nothing configured is the normal first state, not a failure: the app
           ships with no playlists and suggests none. -->
      <div v-if="!settings.playlists.length" class="grid h-full place-items-center">
        <div class="flex max-w-md flex-col items-center gap-3 text-center">
          <v-icon :icon="mdiTelevisionPlay" size="48" class="opacity-30" />
          <div class="text-title-large">
            {{ $t('No channels yet') }}
          </div>
          <p class="text-body-medium opacity-70">
            {{ $t('Live TV plays from an M3U playlist — the link an IPTV subscription or a public channel index gives you. Add one and its channels show up here.') }}
          </p>
          <v-btn variant="tonal" :prepend-icon="mdiPlaylistPlus" :to="localePath('/settings/sources')">
            {{ $t('Add a playlist') }}
          </v-btn>
        </div>
      </div>

      <template v-else>
        <div
          v-if="visible.length"
          class="grid gap-x-4 gap-y-5"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${ui.cardWidth}px, 1fr))` }"
        >
          <channel-card v-for="channel in visible" :key="channel.id" :channel="channel" />
        </div>

        <div class="flex flex-col items-center justify-center gap-2 py-8">
          <v-progress-circular v-if="pending" />

          <template v-else-if="failure">
            <v-icon :icon="mdiAlertCircleOutline" color="error" />
            <span class="text-body-medium opacity-70">{{ failure }}</span>
            <v-btn :prepend-icon="mdiRefresh" variant="tonal" size="small" @click="reload()">
              {{ $t('Retry') }}
            </v-btn>
          </template>

          <template v-else-if="!matches.length">
            <v-icon :icon="mdiTelevisionPlay" size="40" class="opacity-30" />
            <span class="text-body-medium opacity-70">{{ $t('No channel matches that.') }}</span>
          </template>

          <span v-else-if="visible.length >= matches.length" class="text-body-small opacity-45">
            {{ $t('{count} channels', { count: matches.length }) }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
