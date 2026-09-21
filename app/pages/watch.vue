<script lang="ts" setup>
import type MpvPlayer from '~/components/MpvPlayer.vue'
import type { CastDevice } from '~/utils/cast'
import type { MediaType } from '~/utils/tmdb'
import type { Release, TorrentStats } from '~/utils/torrents'
import {
  mdiAccountGroup,
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiCastConnected,
  mdiDownload,
  mdiPowerPlugOutline,
  mdiReload,
  mdiStop,
  mdiSwapHorizontal,
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

/**
 * Set while the film playing streams rather than downloads: its torrent, and
 * the bytes in its file, which is what the buffer's bitrate comes from.
 */
const streaming = ref<{ id: number, length: number } | null>(null)

/**
 * A film cast to this device, and the swarm figures the device that sent it
 * answers for — polled, because this device's own engine has never heard of it.
 *
 * Without them a cast was a bare "Buffering" with nothing after it: no speed, no
 * peers, no idea whether the film was two minutes away or never coming. The
 * other device knows all three and its mirror already answers the question (see
 * `mirrorParts`), which is also what makes the dead-swarm notice below work on
 * the receiving screen rather than only on the one nobody is watching.
 */
const castStats = ref<TorrentStats | null>(null)
useIntervalFn(async () => {
  const parts = mirrorParts(src.value)
  castStats.value = parts ? await torrentStats(parts.id, parts.engine) : null
}, 3000)

// The downloads store already polls every torrent's stats for the whole app, so
// a second poll of this one would only ask the engine the same question twice.
const stats = computed(() => downloads.torrents.find(t => t.id === torrentId.value)?.stats ?? castStats.value)

/** Releases given up on in this sitting — see `exclude` in `startTorrent`. */
const abandoned = ref<string[]>([])

// Bumped on every start and on the way out, so a lookup that lands after you
// left the page — or jumped to another episode — doesn't reach back in and give
// the connection to something nobody is watching. (The trick useMediaFeed uses.)
let generation = 0

async function start() {
  const mine = ++generation
  errorMsg.value = ''
  src.value = ''
  torrent.value = null
  streaming.value = null
  // With the rest of them: `tryAnother` deletes the torrent this still names, and
  // leaving it set points `stats` at an id the engine no longer has.
  torrentId.value = null

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
      // What the picker knew the release to weigh, so a copy too big to keep
      // streams from the first byte rather than landing in the download folder.
      bytes: Number(route.query.size) || undefined,
      season: season.value,
      episode: episode.value,
      fileIndex: fileIndex.value,
      exclude: abandoned.value,
      // Known before it is playing, so a release that fails on the way up is
      // still something `tryAnother` can give up on — and so the screen can name
      // what it is waiting for while it waits.
      onPicked: release => {
        if (mine === generation)
          torrent.value = release
      },
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

    // A film this device can't keep plays through a window of its torrent —
    // sized now from a guess at how long it runs, and again below once the
    // player knows.
    if (started.stream) {
      streaming.value = { id: started.id, length: started.length }
      await downloads.buffer(started.id, started.length)
    }

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

// The buffer is sized at the film's bitrate, which needs its running time — and
// that is known once the player has opened the file, not before.
watch(() => player.value?.duration, duration => {
  if (streaming.value && duration)
    downloads.buffer(streaming.value.id, streaming.value.length, duration)
})

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
})

// Unmounted, not before: the player's own unmount hook is what writes down where
// playback got to (`saveProgress`), and Vue runs it after its parent's
// `onBeforeUnmount`. Released there, "delete it once watched" was decided on the
// progress from before the last save — so a film left in its credits was kept.
onUnmounted(() => {
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

/**
 * What the bar over the film calls it.
 *
 * "Loading…" only while a title is genuinely on its way. A link, a local file,
 * a live channel and a bare magnet are all played without one — nothing is
 * being looked up and nothing ever arrives — so the bar sat there claiming a
 * title was coming for the length of the film. An episode with no name still
 * says which episode it is, which is the part a season pack's viewer needs.
 */
const heading = computed(() => {
  const named = title.value?.title || String(route.query.title ?? '')
  const name = named || (id.value && !mediaError.value ? $t('Loading…') : '')
  const tag = season.value && episode.value ? `S${season.value}E${episode.value}` : ''
  return [name, tag].filter(Boolean).join(' · ')
})

const progressPct = computed(() => {
  const s = stats.value
  return s?.total_bytes ? Math.min(100, (s.progress_bytes / s.total_bytes) * 100) : 0
})

const speed = computed(() => stats.value?.live?.download_speed.human_readable ?? '—')
const peers = computed(() => stats.value?.live?.snapshot.peer_stats.live ?? 0)

/**
 * How much of the film is here. A percentage of a stream only ever says "a
 * few", so a stream says how big its buffer is instead.
 */
const held = computed(() => streaming.value
  ? $t('{size} buffered', { size: bytesText(stats.value?.progress_bytes ?? 0) })
  : `${progressPct.value.toFixed(0)}%`)

/**
 * How long nothing may arrive before the spinner stops being a wait and starts
 * being a dead release.
 *
 * The test is bytes *arriving* and not pieces completing. A collection is often
 * cut into 32 MiB pieces, and on a swarm that is working perfectly well one of
 * those takes a minute to land — `progress_bytes` sits still for all of it, so
 * reading that would call a healthy film dead. `download_speed` moves with every
 * block, so zero for this long means the swarm is handing over nothing at all.
 */
const DEAD_MS = 45_000

/**
 * Half of "this release is dead": nothing has arrived for a while. The other
 * half is the player's — whether it is actually starved — because silence on its
 * own is perfectly normal. A finished film has nothing left to fetch, and a
 * stream whose buffer window is full has nothing to fetch *yet*; both sit at
 * 0 MiB/s while playing perfectly. Only a player that is stalled *and* a swarm
 * that is quiet means the release is the problem (see `stuck` in MpvPlayer).
 *
 * Only while the torrent is live and unfinished: a paused one (told to wait for
 * Wi-Fi, or released on the way out) is silent because the app stopped it, and
 * blaming its seeders for that would be a lie.
 */
const quiet = ref(false)
let arrivedAt = Date.now()
watch(stats, s => {
  if (s?.state !== 'live' || s.finished || s.live?.download_speed.mbps)
    arrivedAt = Date.now()
  quiet.value = s?.state === 'live' && !s.finished && Date.now() - arrivedAt > DEAD_MS
})

/**
 * One line for the player's "buffering" notice, where there's no room for a
 * table. Empty while a direct link plays: there is no swarm to report on, and
 * "0 peers" reads as a fault rather than as "not applicable".
 */
const statusLine = computed(() =>
  stats.value ? `${speed.value} · ${$t('{count} peers', { count: peers.value })} · ${held.value}` : '')

/**
 * Is there anything else to play? A bare magnet and a link were both named by
 * the user rather than searched for, so there is no second release behind them
 * and nothing for the button to fall back to.
 *
 * Deliberately *not* `downloaded`, which reads as "this title has a copy" and is
 * true of every film the moment it starts playing — `downloads.start` files the
 * torrent under the title's key before the first byte. It would have taken the
 * button away in exactly the case it exists for. A film genuinely on the disk
 * needs no button anyway: it never stalls, so `quiet` never pairs with one.
 */
const pickable = computed(() => !!id.value && !magnet.value && !link.value)

/**
 * Give up on the release that stopped arriving and play the next best one.
 *
 * Deleted rather than paused, and deliberately: its bytes are worth nothing,
 * and `cached` is pruned to what the engine still holds — so deleting is also
 * what stops the next Play resuming the copy just abandoned. The hand-pick goes
 * with it for the same reason, and `abandoned` covers the rest of this sitting,
 * where all three could otherwise lead straight back to the same silence.
 */
let switching = false
async function tryAnother() {
  // The button is on screen until `start` empties `src`, and that is a delete
  // round trip away — long enough for a second press to land, which on a remote
  // is one held OK. Two presses would give up on two releases for one complaint.
  if (switching)
    return
  switching = true
  const dud = torrentId.value
  // The engine's spelling where there is a torrent, the source's where the play
  // never got that far — a release that failed before it was added has no id
  // here, and is exactly the one being given up on.
  const hash = downloads.torrents.find(t => t.id === dud)?.info_hash || torrent.value?.hash
  if (hash)
    abandoned.value.push(hash)
  if (dud !== null)
    await downloads.act(dud, 'delete').catch(() => {})
  downloads.unpick(key.value)
  try {
    await start()
  }
  finally {
    switching = false
  }
}

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
  if (!id.value)
    return stepOut()
  // The title page is a chunk of its own, and a Continue-watching start has
  // never loaded it. A chunk that fails to arrive (the dev proxy on a TV, in
  // the case that found this) rejects the navigation, and a rejection with no
  // handler left the film on screen with BACK doing nothing.
  Promise.resolve(navigateTo(mediaLink({ id: Number(id.value), type: type.value }), { replace: true })).catch(stepOut)
}

/** Back a step, or home for a player opened straight from a link. */
function stepOut() {
  if (router.options.history.state.back)
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
            <!-- The swarm this screen is now the only witness to: cast before a
                 film has a head start, the other device simply waits, and both
                 screens used to say nothing at all about why. -->
            <div v-if="statusLine" class="text-body-small tabular-nums opacity-50">
              {{ statusLine }}
            </div>
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
              <!-- This screen is where a release that never got as far as the
                   player lands: no details from the swarm, no video in the
                   torrent. Trying the same one again is rarely the fix. -->
              <v-btn
                v-if="pickable && torrent"
                variant="tonal"
                :prepend-icon="mdiSwapHorizontal"
                @click="tryAnother"
              >
                {{ $t('Try a different release') }}
              </v-btn>
              <v-btn variant="text" :prepend-icon="mdiArrowLeft" @click="leave">
                {{ $t('Back') }}
              </v-btn>
            </div>
          </template>

          <template v-else>
            <v-progress-circular indeterminate color="primary" size="40" />
            <!-- A link or a local file has no title to name, and `step` below is
                 the line that actually says what is happening. -->
            <div v-if="heading" class="text-title-large">
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
                · {{ $t('{count} seeders', { count: torrent.seeders ?? '?' }) }}
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
        :quiet="quiet"
        :pickable="pickable"
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
        @another="tryAnother"
      >
        <template #start>
          <v-btn icon variant="text" density="comfortable" @click="leave">
            <v-icon :icon="mdiArrowLeft" />
            <v-tooltip activator="parent" :text="$t('Back (Esc)')" />
          </v-btn>
          <cast-button :src="src" :play="castPlay" @casting="handOver" />
        </template>

        <template #info>
          <div class="flex min-w-0 items-center gap-4">
            <div class="min-w-0">
              <div v-if="heading" class="truncate text-title-medium">
                {{ heading }}
              </div>
              <div v-if="torrent" class="truncate text-body-small opacity-50">
                {{ torrent.quality }} · {{ torrent.size }} · {{ torrent.source }}
              </div>
            </div>

            <v-spacer />

            <!-- Swarm figures, so only while a torrent is what's playing. -->
            <div v-if="stats" class="flex shrink-0 items-center gap-3 text-body-small opacity-70">
              <span v-tooltip:top="$t('Download speed')" class="flex items-center gap-1">
                <v-icon :icon="mdiDownload" size="14" />{{ speed }}
              </span>
              <span v-tooltip:top="$t('Connected peers')" class="flex items-center gap-1">
                <v-icon :icon="mdiAccountGroup" size="14" />{{ peers }}
              </span>
              <span v-tooltip:top="streaming ? $t('Kept on this device while it plays, and deleted when you stop') : $t('Downloaded')" class="tabular-nums">{{ held }}</span>
              <span v-if="!streaming" class="hidden opacity-50 xl:inline">
                {{ bytesText(stats.progress_bytes) }} / {{ bytesText(stats.total_bytes) }}
              </span>
            </div>
          </div>
        </template>
      </mpv-player>
    </v-main>
  </v-app>
</template>
