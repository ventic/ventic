<script lang="ts" setup>
import type MpvPlayer from '~/components/MpvPlayer.vue'
import type { CastDevice } from '~/utils/cast'
import type { MediaType } from '~/utils/tmdb'
import type { Release } from '~/utils/torrents'
import {
  mdiAccountGroup,
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiCastConnected,
  mdiDownload,
  mdiPowerPlugOutline,
  mdiReload,
  mdiStop,
} from '@mdi/js'

// The player owns the whole window: no app bar, no drawer, no page scroll.
definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const downloads = useDownloadsStore()
const library = useLibraryStore()
const settings = useSettingsStore()

const type = computed<MediaType>(() => route.query.type === 'tv' ? 'tv' : 'movie')
const id = computed(() => String(route.query.id ?? ''))
const season = computed(() => Number(route.query.s) || 0)
const episode = computed(() => Number(route.query.e) || 0)
// The downloads page knows exactly which file in a pack it wants played.
const fileIndex = computed(() => route.query.file == null ? null : Number(route.query.file))
const magnet = computed(() => String(route.query.magnet ?? ''))
/** A release the picker resolved to a plain link — played as-is, no engine. */
const link = computed(() => String(route.query.url ?? ''))
/**
 * A live channel. Set by the Live TV page, which is the only thing that knows:
 * an HLS URL looks the same live or not, and both mpv and ExoPlayer report a
 * usable duration for one often enough that guessing is worse than being told.
 */
const live = computed(() => route.query.live === '1')

/**
 * Seconds to open at, overriding whatever this device remembers. Only a cast
 * sets it: the film was being watched somewhere else, and this device's own
 * library has never heard of it (see plugins/cast.client.ts).
 */
const startAt = computed(() => Number(route.query.t) || 0)

/** What this playback is remembered as — no id (a bare magnet) means nothing. */
const key = computed(() => id.value ? progressKey(type.value, id.value, season.value, episode.value) : '')

/** This title has a copy on this device — one that needs no network at all. */
const downloaded = computed(() => !!downloads.cachedFor(key.value) || !!downloads.localFor(key.value))

// TMDB is only asked for the IMDb id (what a source is keyed by) and a title
// to show while the torrent warms up.
const { data: media, error: mediaError } = useMediaDetail(type, id)

// Offline, TMDB answers nothing — but anything played before left its poster and
// title in the local library, and that is enough to draw this page and to keep
// recording progress against.
const known = computed(() => library.media[titleKey(type.value, id.value)] ?? null)
const title = computed(() => media.value ?? known.value)

const step = ref($t('Loading title…'))
const errorMsg = ref('')
const torrent = ref<Release | null>(null)
const torrentId = ref<number | null>(null)
const src = ref('')

// The downloads store already polls every torrent's stats for the whole app, so
// a second poll of this one would only ask the engine the same question twice.
const stats = computed(() => downloads.torrents.find(t => t.id === torrentId.value)?.stats ?? null)

// Bumped on every start and on the way out, so a lookup that lands after you
// left the page — or jumped to another episode — doesn't reach back in and give
// the connection to something nobody is watching. (The trick useMediaFeed uses.)
let generation = 0

async function start() {
  const mine = ++generation
  errorMsg.value = ''
  src.value = ''
  torrent.value = null

  try {
    // ?magnet=… hand-picks the release and skips the lookup — that's how the
    // downloads page replays something already in the engine, and the only
    // path that works with no sources configured.
    const started = await downloads.start(key.value, {
      // Waited for only if the sources are actually going to be searched. A copy
      // already on disk plays with TMDB unreachable, and hanging on this lookup
      // first is what used to make a downloaded film slow to start.
      imdbId: async () => {
        step.value = $t('Loading title…')
        await until(() => !!media.value || !!mediaError.value).toBe(true, { timeout: 20_000 })
        return media.value?.imdbId
      },
      // Read only once the lookup above has answered, so a download the app
      // never filed under this title can still be recognised by its name.
      named: () => title.value,
      magnet: magnet.value,
      url: link.value,
      season: season.value,
      episode: episode.value,
      fileIndex: fileIndex.value,
      onStep: value => (step.value = value),
    })

    if (mine !== generation)
      return

    torrent.value = started.torrent
    // A direct link has no torrent behind it, so there are no stats to read.
    torrentId.value = started.url ? null : started.id

    // Pause everything else before the stream starts, so the first buffer gets
    // the whole connection. Nothing to pause for a finished torrent — see `focus`.
    await downloads.focus(started.id)

    step.value = $t('Buffering…')
    src.value = started.url || streamUrl(started.id, started.index)
  }
  catch (e) {
    if (mine === generation)
      errorMsg.value = e instanceof Error ? e.message : String(e)
  }
}

// Driven by the route alone — the title resolving is `start`'s business now, so
// that a downloaded film never waits on TMDB. Fires again if you jump straight
// to another episode without leaving the player.
watch(
  () => [key.value, magnet.value, link.value, fileIndex.value].join('|'),
  () => start(),
  { immediate: true },
)

// Leaving the player stops the download and hands the connection back to
// whatever was paused for it. Every exit route unmounts — Esc, Back, the browser
// history, switching to another title — so this is the one place it belongs.
// ---------------------------------------------------------------------------
// Casting — this film, playing on another device on the network
// ---------------------------------------------------------------------------

/** Where this film was handed to, for as long as it is playing there. */
const castTo = ref<CastDevice | null>(null)

/** The live player, for the one thing only it knows: where playback is now. */
const player = useTemplateRef<InstanceType<typeof MpvPlayer>>('player')

/**
 * Everything the other device needs but the URL, which CastButton builds.
 *
 * A function rather than a computed, and the position comes off the player
 * rather than out of the library: the stored resume point is only written when
 * playback pauses or stops, and `resumeAt` discards anything under a minute
 * besides — so a film cast twenty minutes in, having never been paused, handed
 * over a zero and started the television from the top. Read at the moment the
 * button is pressed, the answer is simply the second on screen.
 */
function castPlay() {
  return {
    kind: type.value,
    id: id.value,
    season: season.value,
    episode: episode.value,
    title: title.value?.title ?? String(route.query.title ?? ''),
    position: player.value?.position ?? 0,
  }
}

function handOver(device: CastDevice) {
  castTo.value = device
  // Two players pulling the same torrent for the same film is the one thing
  // that would make the cast worse than not casting.
  generation++
  src.value = ''
}

/**
 * Stop serving the film to the network and let the download go back to normal.
 * `release` is the one `onBeforeUnmount` deliberately skipped while a cast was
 * running: it pauses the torrent, and the torrent is what the other device is
 * reading from.
 */
async function stopCasting() {
  // The other device first, while it still has something to read: stopping the
  // mirror underneath it would leave the film up until the buffer ran dry and
  // then look like the network failing. `settings.castTarget` rather than
  // `castTo`, so this is the same call Settings makes — see `stopCast`.
  await stopCast(settings.castTarget)
  castTo.value = null
  await downloads.release()
  leave()
}

onBeforeUnmount(() => {
  generation++
  // Not while casting: another device is streaming this torrent from here, and
  // `release` pauses it. Stopping the cast is what hands it back.
  if (!castTo.value)
    downloads.release()
})

// A magnet, a link and a copy on disk all need no TMDB, so a failed lookup is
// only a failure to play when the sources were the plan.
const failure = computed(() => errorMsg.value
  || (mediaError.value && !magnet.value && !link.value && !downloaded.value
    ? $t('Couldn\'t load this title from TMDB.')
    : ''))

/** The one failure whose fix is a button away rather than a retry. */
const noSources = computed(() => failure.value === NO_SOURCES())

const heading = computed(() => {
  const name = title.value?.title ?? (route.query.title as string) ?? $t('Loading…')
  return season.value && episode.value ? `${name} · S${season.value}E${episode.value}` : name
})

const progressPct = computed(() => {
  const s = stats.value
  return s?.total_bytes ? Math.min(100, (s.progress_bytes / s.total_bytes) * 100) : 0
})

const speed = computed(() => stats.value?.live?.download_speed.human_readable ?? '—')
const peers = computed(() => stats.value?.live?.snapshot.peer_stats.live ?? 0)
/**
 * One line for the player's "buffering" notice, where there's no room for a
 * table. Empty while a direct link plays: there is no swarm to report on, and
 * "0 peers" reads as a fault rather than as "not applicable".
 */
const statusLine = computed(() =>
  stats.value ? `${speed.value} · ${peers.value} peers · ${progressPct.value.toFixed(0)}%` : '')

const backdrop = computed(() => backdropUrl(title.value?.backdrop, 'w1280'))

// What the end-of-playback screen offers. The show's season list carries an
// episode count per season, which is all the rollover needs.
const next = computed(() => {
  if (!media.value || !season.value || !episode.value)
    return null
  const target = nextEpisode(media.value.seasons, { season: season.value, episode: episode.value, watched: true })
  if (!target)
    return null
  return {
    to: watchLink('tv', id.value, target.season, target.episode),
    label: $t('Next · S{season} E{episode}', { season: target.season, episode: target.episode }),
  }
})

/**
 * Out of the player, to the title's own page rather than back a step. An
 * episode rolls over into the next one, so the entry behind this is whatever
 * you launched from — the episode you *started* with, not the one on screen —
 * and for a show the useful place to land is the show. `replace`, so Back from
 * there carries on out rather than walking into a finished player.
 *
 * A bare magnet has no title and no page to land on; that one still steps back.
 */
function leave() {
  if (id.value)
    navigateTo(mediaLink({ id: Number(id.value), type: type.value }), { replace: true })
  else if (router.options.history.state.back)
    router.back()
  else
    navigateTo(localePath('/'))
}

// preventDefault marks the press as used up, which is how the remote's back key
// knows it doesn't also have to go back a page (see plugins/dpad.client.ts) —
// and the same file's test for "a dialog owns the screen" is what keeps Escape
// off the film while the cast dialog is up: that press closes the dialog.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !document.querySelector('.v-overlay--active:not(.v-tooltip)')) {
    e.preventDefault()
    leave()
  }
})
</script>

<template>
  <v-app>
    <v-main class="h-dvh overflow-hidden bg-black text-white">
      <!-- Everything before mpv has a stream to open. -->
      <div v-if="!src" class="relative grid h-full place-items-center">
        <img
          v-if="backdrop"
          :src="backdrop"
          alt=""
          class="absolute inset-0 h-full w-full object-cover opacity-20 blur-2xl"
        >

        <div class="relative flex max-w-xl flex-col items-center gap-3 px-6 text-center">
          <!-- Handed over. This device keeps the torrent alive and serves it;
               there is nothing else for it to do until the cast is stopped. -->
          <template v-if="castTo">
            <v-icon :icon="mdiCastConnected" color="primary" size="40" />
            <div class="text-title-large">
              {{ $t('Playing on {device}', { device: castTo.name }) }}
            </div>
            <p class="text-body-medium opacity-70">
              {{ $t('This device is streaming the film to it. Leave Ventic running until you\'re done — closing it stops the stream.') }}
            </p>
            <div class="mt-2 flex gap-2">
              <v-btn variant="tonal" :prepend-icon="mdiStop" @click="stopCasting">
                {{ $t('Stop casting') }}
              </v-btn>
            </div>
          </template>

          <template v-else-if="failure">
            <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
            <div class="text-title-large">
              {{ $t('Nothing to play') }}
            </div>
            <p class="text-body-medium opacity-70">
              {{ failure }}
            </p>
            <div class="mt-2 flex gap-2">
              <v-btn
                v-if="noSources"
                variant="tonal"
                :prepend-icon="mdiPowerPlugOutline"
                :to="localePath('/settings/sources')"
              >
                {{ $t('Add a source') }}
              </v-btn>
              <v-btn v-else variant="tonal" :prepend-icon="mdiReload" @click="start">
                {{ $t('Try again') }}
              </v-btn>
              <v-btn variant="text" :prepend-icon="mdiArrowLeft" @click="leave">
                {{ $t('Back') }}
              </v-btn>
            </div>
          </template>

          <template v-else>
            <v-progress-circular indeterminate color="primary" size="40" />
            <div class="text-title-large">
              {{ heading }}
            </div>
            <div class="text-body-medium opacity-70">
              {{ step }}
            </div>
            <div v-if="torrent" class="text-body-small opacity-50">
              {{ torrent.quality }} · {{ torrent.size }}
              <template v-if="torrent.url">
                · {{ $t('direct link') }}
              </template>
              <template v-else>
                · {{ $t('{count} seeders', { count: torrent.seeders }) }}
              </template>
              · {{ torrent.source }}
              <div class="mt-1 truncate">
                {{ torrent.name }}
              </div>
            </div>
            <v-btn class="mt-2" variant="text" size="small" :prepend-icon="mdiArrowLeft" @click="leave">
              {{ $t('Back') }}
            </v-btn>
          </template>
        </div>
      </div>

      <!-- :key so picking a different file/torrent gets a fresh mpv process. -->
      <mpv-player
        v-else
        ref="player"
        :key="src"
        :src="src"
        :status="statusLine"
        :media="title"
        :next="next"
        :imdb-id="media?.imdbId"
        :title="title?.title ?? String(route.query.title ?? '')"
        :year="title?.year"
        :season="season"
        :episode="episode"
        :live="live"
        :start-at="startAt"
        fullscreen
        @exit="leave"
      >
        <template #start>
          <v-btn icon variant="text" density="comfortable" :title="$t('Back (Esc)')" @click="leave">
            <v-icon :icon="mdiArrowLeft" />
          </v-btn>
          <cast-button :src="src" :play="castPlay" @casting="handOver" />
        </template>

        <template #info>
          <div class="flex min-w-0 items-center gap-4">
            <div class="min-w-0">
              <div class="truncate text-title-medium">
                {{ heading }}
              </div>
              <div v-if="torrent" class="truncate text-body-small opacity-50">
                {{ torrent.quality }} · {{ torrent.size }} · {{ torrent.source }}
              </div>
            </div>

            <v-spacer />

            <!-- Swarm figures, so only while a torrent is what's playing. -->
            <div v-if="stats" class="flex shrink-0 items-center gap-3 text-body-small opacity-70">
              <span class="flex items-center gap-1" :title="$t('Download speed')">
                <v-icon :icon="mdiDownload" size="14" />{{ speed }}
              </span>
              <span class="flex items-center gap-1" :title="$t('Connected peers')">
                <v-icon :icon="mdiAccountGroup" size="14" />{{ peers }}
              </span>
              <span class="tabular-nums" :title="$t('Downloaded')">{{ progressPct.toFixed(0) }}%</span>
              <span class="hidden opacity-50 xl:inline">
                {{ bytesText(stats.progress_bytes) }} / {{ bytesText(stats.total_bytes) }}
              </span>
            </div>
          </div>
        </template>
      </mpv-player>
    </v-main>
  </v-app>
</template>
