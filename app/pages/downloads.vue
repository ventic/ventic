<script setup lang="ts">
import type { StatusKey } from '~/stores/downloads'
import type { EngineFile, EngineTorrent } from '~/utils/torrents'
import {
  mdiAlertCircleOutline,
  mdiArrowUp,
  mdiCheck,
  mdiContentCopy,
  mdiDeleteOutline,
  mdiDotsVertical,
  mdiFolderOpenOutline,
  mdiMagnetOn,
  mdiMagnify,
  mdiPause,
  mdiPlay,
  mdiProgressClock,
  mdiTrayArrowDown,
} from '@mdi/js'

/**
 * The transfer list. One list for every screen — a row that stacks its stats
 * under the name is the same row at 400px and at 1400 — and nothing Vuetify
 * inside it: a poll rebuilds every torrent every two seconds, and a hundred
 * rows of progress bars, chips, buttons and tooltips were a hundred rows of a
 * dozen components each re-rendering on every tick. Plain elements patch as a
 * few text nodes, and `content-visibility` keeps the rows off screen from
 * costing a paint at all, which is the same bargain the poster grids make.
 *
 * The state filters that used to be a sidebar are chips above the list, so the
 * page lives in the ordinary layout: the sidebar on a desktop, the bar along
 * the bottom on a phone, and one fewer shell to keep in step with them.
 */
const downloads = useDownloadsStore()
const canReveal = canOpenFolder()

/** Which torrent's files are open — one at a time, so one open row is one request (see DownloadFiles). */
const expanded = ref<string | null>(null)
const removing = ref<EngineTorrent | null>(null)
const toast = ref('')

/**
 * The row whose menu is up, and the button it opened from — one menu for the
 * whole list rather than one per row, which is what keeps a row free of
 * overlays. A long press on the row (or a held OK on a television) opens the
 * same menu at the row, exactly as a card's sheet opens — see MediaMenu.
 */
const menuFor = ref<EngineTorrent | null>(null)
const menuAt = ref<HTMLElement | null>(null)

function openMenu(t: EngineTorrent, e: Event) {
  menuAt.value = e.currentTarget as HTMLElement
  menuFor.value = t
}

/** Run one menu action and close the menu behind it. */
function pick(fn: () => unknown) {
  const t = menuFor.value
  menuFor.value = null
  if (t)
    fn()
}

/** How a state is drawn at the head of a row: shape as well as colour. */
const STATUS_LOOK: Record<StatusKey, { icon: string, class: string }> = {
  downloading: { icon: mdiTrayArrowDown, class: 'bg-primary/15 text-primary' },
  done: { icon: mdiCheck, class: 'bg-success/15 text-success' },
  paused: { icon: mdiPause, class: 'bg-warning/15 text-warning' },
  checking: { icon: mdiProgressClock, class: 'bg-info/15 text-info' },
  error: { icon: mdiAlertCircleOutline, class: 'bg-error/15 text-error' },
}

/** A row's icon buttons — plain, for the reason the row is. */
const ACT = 'grid size-10 shrink-0 place-items-center border-0 rounded-lg bg-transparent text-on-surface opacity-75 transition-colors hover:bg-surface-container-high hover:opacity-100 focus-visible:bg-surface-container-high focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-30'

/**
 * The player takes it from the engine by hash, so nothing is re-downloaded.
 *
 * The title it was downloaded for goes along too, when the store can still say
 * (`titleFor`). Without it this is a bare magnet — which plays perfectly and is
 * then forgotten the moment the player closes: no progress, no History, no
 * Continue watching. The magnet stays regardless, so the file already on the
 * disk is what plays, and the season/episode steers the pick inside a pack.
 */
function play(t: EngineTorrent, index?: number, file?: EngineFile) {
  const key = downloads.titleFor(t.info_hash, index ?? null, file)
  const of = key ? parseKey(key) : null
  navigateTo({
    path: localePath('/watch'),
    query: {
      magnet: magnetForHash(t.info_hash),
      title: t.name ?? '',
      ...index == null ? {} : { file: String(index) },
      ...of ? { type: of.type, id: String(of.id) } : {},
      ...of?.season ? { s: String(of.season), e: String(of.episode) } : {},
    },
  })
}

async function toggle(t: EngineTorrent) {
  await downloads.act(t.id, t.stats?.state === 'paused' ? 'start' : 'pause')
}

async function remove(t: EngineTorrent, keepFiles: boolean) {
  removing.value = null
  if (expanded.value === t.info_hash)
    expanded.value = null
  await downloads.act(t.id, keepFiles ? 'forget' : 'delete')
}

/**
 * Where the data actually landed. `output_folder` is the torrent's own folder
 * and a file's components are relative to it, so a file inside a pack opens the
 * subfolder it sits in rather than the root.
 */
async function openFolder(t: EngineTorrent, file?: EngineFile) {
  const parts = file?.components?.slice(0, -1) ?? []
  // The engine hands back a native path, so on Windows it is already
  // backslash-separated — appending components with `/` would hand the shell a
  // path it opens only sometimes.
  const sep = t.output_folder.includes('\\') ? '\\' : '/'
  try {
    await useTauriShellOpen([t.output_folder, ...parts].join(sep))
  }
  catch (e) {
    toast.value = $t('Couldn\'t open the folder: {error}', { error: e instanceof Error ? e.message : String(e) })
  }
}

async function copyMagnet(t: EngineTorrent) {
  await navigator.clipboard.writeText(magnetForHash(t.info_hash))
  toast.value = $t('Magnet link copied.')
}

async function all(action: 'pause' | 'start') {
  await Promise.all(downloads.list.map(t => torrentAction(t.id, action).catch(() => {})))
  await downloads.refresh()
}

const paused = computed(() => downloads.counts.paused)

/** The whole row is the expander, rather than a 44px chevron at the end of it. */
function toggleOpen(t: EngineTorrent) {
  expanded.value = expanded.value === t.info_hash ? null : t.info_hash
}

/**
 * "62% · 1.4 GB · 3.1 MB/s · 12 peers · 8m left", minus whatever the engine
 * hasn't got yet. One line under the name, where a table had a column each.
 */
function meta(t: EngineTorrent) {
  const s = t.stats
  const live = s?.live
  return [
    `${percentOf(t).toFixed(0)}%`,
    bytesText(s?.total_bytes ?? 0),
    // A finished torrent downloads nothing; "0 B/s" beside it reads as stuck.
    s?.finished ? '' : live?.download_speed.human_readable,
    live?.snapshot.peer_stats.live ? $t('{count} peers', { count: live.snapshot.peer_stats.live }) : '',
    // Nothing is "8m left" once it has finished, whatever the engine still says.
    !s?.finished && live?.time_remaining?.human_readable ? $t('{time} left', { time: live.time_remaining.human_readable }) : '',
  ].filter(Boolean).join(' · ')
}

function mbps(value: number) {
  return $t('{rate} MiB/s', { rate: value.toFixed(1) })
}

// --- Adding a magnet by hand --------------------------------------------------

const adding = ref(false)
const magnet = ref('')
const addError = ref('')
const busy = ref(false)

/**
 * A hand-pasted magnet is added whole — unlike the app's own downloads, which
 * narrow to the one file being watched. The file list is where you trim it.
 */
async function add() {
  busy.value = true
  addError.value = ''
  try {
    await addTorrent(magnet.value.trim())
    await downloads.refresh()
    adding.value = false
    magnet.value = ''
  }
  catch (e) {
    addError.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="shrink-0 flex flex-col gap-2 px-3 pb-3 md:px-6">
      <div class="flex items-center gap-2">
        <h1 class="text-title-large shrink-0">
          {{ $t('Downloads') }}
        </h1>

        <!-- Speeds for the whole engine, where the sidebar's footer used to
             show them. Hidden on a phone, where every row carries its own. -->
        <span class="hidden items-center gap-3 pl-2 text-body-small tabular-nums opacity-55 sm:flex">
          <span class="flex items-center gap-1">
            <v-icon :icon="mdiTrayArrowDown" size="14" />{{ mbps(downloads.speed.down) }}
          </span>
          <span class="flex items-center gap-1">
            <v-icon :icon="mdiArrowUp" size="14" />{{ mbps(downloads.speed.up) }}
          </span>
          <!-- Why a film you watched last month is no longer here. -->
          <span v-if="isFinite(downloads.budget)" class="hidden md:inline">
            · {{ bytesText(downloads.used) }} / {{ bytesText(downloads.budget) }}
            <v-tooltip activator="parent" :text="$t('Cache limit for this device. Over it, the least recently played torrents are deleted.')" />
          </span>
        </span>

        <v-spacer />

        <v-btn icon variant="text" color="on-surface" :disabled="!downloads.list.length" @click="all(paused ? 'start' : 'pause')">
          <v-icon :icon="paused ? mdiPlay : mdiPause" />
          <v-tooltip activator="parent" :text="paused ? $t('Resume all') : $t('Pause all')" />
        </v-btn>
        <v-btn :prepend-icon="mdiMagnetOn" variant="tonal" @click="adding = true">
          {{ $t('Add magnet') }}
        </v-btn>
      </div>

      <div class="flex items-center gap-2">
        <!-- The state filters, with their counts. A chip group scrolls itself
             on a phone, and a d-pad walks it the way it walks every chip row. -->
        <v-chip-group
          v-model="downloads.filter"
          mandatory
          selected-class="bg-primary text-on-primary font-medium"
          class="min-w-0 flex-1"
        >
          <v-chip v-for="f in FILTERS" :key="f.value" :value="f.value" :prepend-icon="f.icon" size="small">
            {{ f.title() }}
            <span class="pl-1.5 tabular-nums opacity-70">{{ downloads.counts[f.value] }}</span>
          </v-chip>
        </v-chip-group>

        <!-- The same parked field the app bar uses, for the same reason: a remote
             crosses this box on its way along the row, and a text field that
             merely has focus puts the on-screen keyboard over the whole screen. -->
        <search-field
          v-model="downloads.query"
          :placeholder="$t('Filter torrents')"
          class="hidden w-56 shrink-0 md:block"
        />
      </div>

      <search-field
        v-model="downloads.query"
        :placeholder="$t('Filter torrents')"
        class="md:hidden"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-6 md:px-4">
      <!-- The reserved height is a closed row; an open one is measured once
           it has been drawn, which `auto` remembers from then on. -->
      <div
        v-for="t in downloads.list"
        :key="t.info_hash"
        class="rounded-xl [contain-intrinsic-size:auto_68px] [content-visibility:auto]"
        :class="expanded === t.info_hash && 'bg-surface-container/45'"
      >
        <div class="flex items-center gap-1 px-2 py-1.5 sm:gap-2">
          <span class="grid size-9 shrink-0 place-items-center rounded-full" :class="STATUS_LOOK[torrentStatus(t)].class" :title="TORRENT_STATUS[torrentStatus(t)].text()">
            <svg viewBox="0 0 24 24" class="size-5 fill-current"><path :d="STATUS_LOOK[torrentStatus(t)].icon" /></svg>
          </span>

          <!-- The name and the bar open the file list; a right-click, a long
               press or a held OK on them opens the menu the ⋮ does. -->
          <button
            type="button"
            class="min-w-0 flex-1 border-0 rounded-lg bg-transparent px-2 py-1 text-left text-on-surface outline-none transition-colors hover:bg-surface-container-high/60 focus-visible:bg-surface-container-high/60"
            @click="toggleOpen(t)"
            @contextmenu.prevent="openMenu(t, $event)"
          >
            <div class="truncate text-body-medium" :title="t.name ?? t.info_hash">
              {{ t.name ?? t.info_hash }}
            </div>
            <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-on-surface/12">
              <div
                class="h-full rounded-full transition-[width] duration-500"
                :class="`bg-${TORRENT_STATUS[torrentStatus(t)].color}`"
                :style="{ width: `${percentOf(t)}%` }"
              />
            </div>
            <div class="mt-1 truncate text-body-small tabular-nums opacity-60">
              {{ meta(t) }}
            </div>
            <div v-if="t.stats?.error" class="truncate text-body-small text-error" :title="t.stats.error">
              {{ t.stats.error }}
            </div>
          </button>

          <button type="button" :class="ACT" :title="$t('Play')" @click="play(t)">
            <svg viewBox="0 0 24 24" class="size-6 fill-current"><path :d="mdiPlay" /></svg>
          </button>
          <!-- Off a phone's row, where three buttons left the name two words
               wide; the menu carries it there. -->
          <button
            type="button"
            class="hidden sm:grid"
            :class="ACT"
            :disabled="t.stats?.finished"
            :title="t.stats?.state === 'paused' ? $t('Resume') : $t('Pause')"
            @click="toggle(t)"
          >
            <svg viewBox="0 0 24 24" class="size-6 fill-current"><path :d="t.stats?.state === 'paused' ? mdiPlay : mdiPause" /></svg>
          </button>
          <button type="button" :class="ACT" :title="$t('More')" @click="openMenu(t, $event)">
            <svg viewBox="0 0 24 24" class="size-6 fill-current"><path :d="mdiDotsVertical" /></svg>
          </button>
        </div>

        <download-files
          v-if="expanded === t.info_hash"
          :torrent="t"
          class="mx-2 mb-2"
          @play="(index, file) => play(t, index, file)"
          @open="file => openFolder(t, file)"
        />
      </div>

      <div v-if="!downloads.list.length" class="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <template v-if="downloads.offline">
          <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
          <span class="text-body-medium opacity-70">{{ $t('Torrent engine offline.') }}</span>
        </template>
        <template v-else-if="downloads.torrents.length">
          <v-icon :icon="mdiMagnify" size="40" class="opacity-30" />
          <span class="text-body-medium opacity-70">{{ $t('No torrents match this filter.') }}</span>
        </template>
        <template v-else>
          <v-icon :icon="mdiTrayArrowDown" size="40" class="opacity-30" />
          <span class="text-body-medium opacity-70">{{ $t('Nothing downloading.') }}</span>
          <span class="text-body-small opacity-50">{{ $t('Hit Download on a movie or an episode, or paste a magnet.') }}</span>
        </template>
      </div>
    </div>

    <!-- One menu for every row, opened where the row asked for it. -->
    <v-menu
      :model-value="!!menuFor"
      :target="menuAt ?? undefined"
      location="bottom end"
      @update:model-value="open => !open && (menuFor = null)"
    >
      <v-list nav density="comfortable" class="min-w-52">
        <v-list-item
          v-if="!menuFor?.stats?.finished"
          :prepend-icon="menuFor?.stats?.state === 'paused' ? mdiPlay : mdiPause"
          :title="menuFor?.stats?.state === 'paused' ? $t('Resume') : $t('Pause')"
          rounded="lg"
          @click="pick(() => toggle(menuFor!))"
        />
        <v-list-item v-if="canReveal" :prepend-icon="mdiFolderOpenOutline" :title="$t('Open folder')" rounded="lg" @click="pick(() => openFolder(menuFor!))" />
        <v-list-item :prepend-icon="mdiContentCopy" :title="$t('Copy magnet')" rounded="lg" @click="pick(() => copyMagnet(menuFor!))" />
        <v-list-item :prepend-icon="mdiDeleteOutline" :title="$t('Remove')" base-color="error" rounded="lg" @click="pick(() => removing = menuFor)" />
      </v-list>
    </v-menu>

    <!-- Deleting the files can't be undone, so it's never one click. -->
    <v-dialog :model-value="!!removing" max-width="460" @update:model-value="removing = null">
      <v-card rounded="xl" class="p-2">
        <v-card-title class="text-title-medium">
          {{ $t('Remove torrent') }}
        </v-card-title>
        <v-card-text class="text-body-medium opacity-70">
          {{ removing?.name ?? removing?.info_hash }}
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" size="small" @click="removing = null">
            {{ $t('Cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" size="small" @click="remove(removing!, true)">
            {{ $t('Keep files') }}
          </v-btn>
          <v-btn variant="tonal" size="small" color="error" @click="remove(removing!, false)">
            {{ $t('Delete files') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="adding" max-width="560">
      <v-card rounded="xl" class="p-2">
        <v-card-title class="text-title-medium">
          {{ $t('Add magnet') }}
        </v-card-title>
        <v-card-text>
          <v-textarea
            v-model="magnet"
            placeholder="magnet:?xt=urn:btih:…"
            rows="3"
            autofocus
            hide-details
          />
          <div v-if="addError" class="pt-2 text-body-small text-error">
            {{ addError }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" size="small" @click="adding = false">
            {{ $t('Cancel') }}
          </v-btn>
          <v-btn variant="tonal" size="small" :loading="busy" :disabled="!magnet.trim()" @click="add">
            {{ $t('Add') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar :model-value="!!toast" timeout="2500" @update:model-value="toast = ''">
      {{ toast }}
    </v-snackbar>
  </div>
</template>
