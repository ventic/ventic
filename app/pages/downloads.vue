<script setup lang="ts">
import type { DataTableHeader } from 'vuetify'
import type { EngineFile, EngineTorrent } from '~/utils/torrents'
import {
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiDeleteOutline,
  mdiFolderOpenOutline,
  mdiMagnify,
  mdiMenu,
  mdiPause,
  mdiPlay,
  mdiPlayCircleOutline,
  mdiTrayArrowDown,
} from '@mdi/js'

definePageMeta({ layout: 'downloads' })

const ui = useUiStore()
const downloads = useDownloadsStore()
const { mobile, lgAndUp } = useDisplay()

const removing = ref<EngineTorrent | null>(null)
const toast = ref('')
const canReveal = canOpenFolder()

// The table owns the sort now; the store only decides which torrents are in the
// list. Empty = the store's order, newest addition first.
const sortBy = ref<{ key: string, order?: boolean | 'asc' | 'desc' }[]>([])

/**
 * `value` is what the table sorts on, the `item.<key>` slots are what it draws.
 * Below lg the three live-stat columns leave the array rather than being hidden
 * in CSS, so the expanded row's colspan stays right.
 */
const headers = computed<DataTableHeader<EngineTorrent>[]>(() => [
  { key: 'data-table-expand', width: 44 },
  { key: 'name', title: $t('Name'), value: t => t.name ?? t.info_hash },
  { key: 'size', title: $t('Size'), value: t => t.stats?.total_bytes ?? 0, align: 'end', width: 88, nowrap: true },
  { key: 'progress', title: $t('Progress'), value: percentOf, width: 176, nowrap: true },
  { key: 'status', title: $t('Status'), value: torrentStatus, width: 116 },
  ...lgAndUp.value
    ? [
        { key: 'speed', title: $t('Down'), value: (t: EngineTorrent) => t.stats?.live?.download_speed.mbps ?? 0, align: 'end', width: 100, nowrap: true },
        { key: 'peers', title: $t('Peers'), value: (t: EngineTorrent) => t.stats?.live?.snapshot.peer_stats.live ?? 0, align: 'end', width: 84 },
        // The engine only gives ETA as prose ("1h 20m"), so there's nothing to sort on.
        { key: 'eta', title: $t('ETA'), sortable: false, align: 'end', width: 100, nowrap: true },
      ] as DataTableHeader<EngineTorrent>[]
    : [],
  { key: 'actions', title: '', sortable: false, align: 'end', width: 168 },
])

// Which torrent's files are on screen. `expand-strategy="single"` holds the
// table to one, and the card list follows the same rule — the file list fetches
// when it mounts (see DownloadFiles.vue), so one open row is one request.
//
// Keyed by info_hash, not the engine's numeric id: the poll hands back freshly
// built objects every two seconds, so anything watching an EngineTorrent would
// see a change — and refetch the file list — on every tick.
const expanded = ref<string[]>([])

const openHash = computed(() => expanded.value[0] ?? null)

function stats(t: EngineTorrent) {
  return t.stats
}

/** The player takes it from the engine by hash, so nothing is re-downloaded. */
function play(t: EngineTorrent, index?: number) {
  navigateTo({
    path: localePath('/watch'),
    query: {
      magnet: magnetForHash(t.info_hash),
      title: t.name ?? '',
      ...index == null ? {} : { file: String(index) },
    },
  })
}

async function toggle(t: EngineTorrent) {
  await downloads.act(t.id, t.stats?.state === 'paused' ? 'start' : 'pause')
}

async function remove(t: EngineTorrent, keepFiles: boolean) {
  removing.value = null
  expanded.value = expanded.value.filter(hash => hash !== t.info_hash)
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

async function all(action: 'pause' | 'start') {
  await Promise.all(downloads.list.map(t => torrentAction(t.id, action).catch(() => {})))
  await downloads.refresh()
}

const paused = computed(() => downloads.counts.paused)

/** Tapping a card is how the file list opens on a phone, the same as a row. */
function toggleOpen(t: EngineTorrent) {
  expanded.value = openHash.value === t.info_hash ? [] : [t.info_hash]
}

/**
 * "3.1 MB/s · 12 peers · 8m left", minus whatever the engine hasn't got yet.
 * The card has one line for all three, where the table has a column each.
 */
function liveText(t: EngineTorrent) {
  const live = t.stats?.live
  return [
    live?.download_speed.human_readable,
    live?.snapshot.peer_stats.live ? `${live.snapshot.peer_stats.live} peers` : '',
    // Nothing is "8m left" once it has finished, whatever the engine still says.
    !t.stats?.finished && live?.time_remaining?.human_readable ? `${live.time_remaining.human_readable} left` : '',
  ].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="shrink-0 flex items-center gap-2 px-3 py-3 sm:px-4">
      <!-- Always-on way out of the transfers shell — the menu button beside it
           only opens the state filters, so this is the only exit on a phone. -->
      <v-btn icon variant="text" color="on-surface" :to="localePath('/')">
        <v-icon :icon="mdiArrowLeft" />
        <v-tooltip activator="parent" :text="$t('Back')" />
      </v-btn>
      <v-btn v-if="mobile" :icon="mdiMenu" variant="text" color="on-surface" @click="ui.drawer = true" />

      <!-- The same parked field the app bar uses, for the same reason: a remote
           crosses this box on its way along the row, and a text field that
           merely has focus puts the on-screen keyboard over the whole screen. -->
      <search-field
        v-model="downloads.query"
        :placeholder="$t('Filter torrents')"
        :density="mobile ? 'default' : 'compact'"
        class="max-w-100 flex-1"
      />

      <!-- ml-auto, not a v-spacer: a spacer also grows, so on a narrow window it
           and the search field's flex-1 split the row 50/50. Flexbox resolves
           grow before auto margins, so the field fills first (up to its max) and
           this margin only takes what's left over to pin the group right. -->
      <div class="ml-auto flex items-center gap-2">
        <span class="hidden text-body-small opacity-55 sm:inline">
          {{ $t('{shown} shown · {active} active', { shown: downloads.list.length, active: downloads.active }) }}
        </span>

        <!-- Why a film you watched last month is no longer here. -->
        <span v-if="isFinite(downloads.budget)" class="hidden text-body-small opacity-55 md:inline">
          · {{ bytesText(downloads.used) }} / {{ bytesText(downloads.budget) }}
          <v-tooltip activator="parent" :text="$t('Cache limit for this device. Over it, the least recently played torrents are deleted.')" />
        </span>

        <!-- Icon-only on a phone: the words do not fit beside a search box that
             is already the width of the screen. -->
        <v-btn
          v-if="mobile"
          :icon="paused ? mdiPlay : mdiPause"
          variant="text"
          color="on-surface"
          :title="paused ? $t('Resume all') : $t('Pause all')"
          @click="all(paused ? 'start' : 'pause')"
        />
        <v-btn v-else :prepend-icon="paused ? mdiPlay : mdiPause" variant="text" size="small" @click="all(paused ? 'start' : 'pause')">
          {{ paused ? $t('Resume all') : $t('Pause all') }}
        </v-btn>
      </div>
    </div>

    <!-- A phone gets cards instead of a table. Not Vuetify's own stacked-row
         fallback: that ignores every `item.*` slot (VDataTableRow only calls
         them when `mobile` is false), and the slots are all of this page — the
         progress bars, the chips, the buttons. Eight columns of fixed widths
         also come to nearly twice a phone's width, so the real table there is a
         side-scroll with the actions permanently off screen. -->
    <div v-if="mobile" class="min-h-0 flex-1 flex flex-col gap-2 overflow-y-auto px-3 pb-4">
      <div
        v-for="item in downloads.list"
        :key="item.info_hash"
        class="flex flex-col gap-2 rounded-xl bg-surface-container/45 p-3"
      >
        <!-- The card is the expander, so the whole thing is one target rather
             than a 44px chevron. -->
        <button class="flex flex-col gap-2 border-0 bg-transparent p-0 text-left text-on-surface" @click="toggleOpen(item)">
          <div class="line-clamp-2 text-body-medium">
            {{ item.name ?? item.info_hash }}
          </div>
          <div v-if="stats(item)?.error" class="text-body-small text-error">
            {{ stats(item)!.error }}
          </div>

          <div class="w-full flex items-center gap-2">
            <v-progress-linear
              :model-value="percentOf(item)"
              :color="TORRENT_STATUS[torrentStatus(item)].color"
              height="6"
              rounded
              class="min-w-0 flex-1"
            />
            <span class="w-9 shrink-0 text-right text-body-small tabular-nums opacity-70">{{ percentOf(item).toFixed(0) }}%</span>
          </div>

          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-small opacity-70">
            <v-chip
              size="x-small"
              :color="TORRENT_STATUS[torrentStatus(item)].color"
              :text="TORRENT_STATUS[torrentStatus(item)].text()"
            />
            <span class="tabular-nums">{{ bytesText(stats(item)?.total_bytes ?? 0) }}</span>
            <span v-if="liveText(item)" class="tabular-nums">· {{ liveText(item) }}</span>
          </div>
        </button>

        <div class="flex items-center justify-end gap-1">
          <v-btn icon variant="text" color="on-surface" density="comfortable" :title="$t('Play')" @click="play(item)">
            <v-icon :icon="mdiPlayCircleOutline" size="22" />
          </v-btn>
          <v-btn
            icon
            variant="text"
            color="on-surface"
            density="comfortable"
            :disabled="stats(item)?.finished"
            :title="stats(item)?.state === 'paused' ? $t('Resume') : $t('Pause')"
            @click="toggle(item)"
          >
            <v-icon :icon="stats(item)?.state === 'paused' ? mdiPlay : mdiPause" size="22" />
          </v-btn>
          <v-btn v-if="canReveal" icon variant="text" color="on-surface" density="comfortable" :title="$t('Open folder')" @click="openFolder(item)">
            <v-icon :icon="mdiFolderOpenOutline" size="22" />
          </v-btn>
          <v-btn icon variant="text" color="on-surface" density="comfortable" :title="$t('Remove')" @click="removing = item">
            <v-icon :icon="mdiDeleteOutline" size="22" />
          </v-btn>
        </div>

        <download-files
          v-if="openHash === item.info_hash"
          :torrent="item"
          @play="index => play(item, index)"
          @open="file => openFolder(item, file)"
          @notify="message => toast = message"
        />
      </div>

      <div v-if="!downloads.list.length" class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
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

    <!-- `mobile: false` holds the real table together above that breakpoint —
         the same slot problem, from the other side. The bracket variants
         restyle Vuetify's own table parts: they land in `uno-default`, a later
         layer than `vuetify-components`, so they win. -->
    <v-data-table
      v-else
      v-model:expanded="expanded"
      v-model:sort-by="sortBy"
      :headers="headers"
      :items="downloads.list"
      :mobile="false"
      item-value="info_hash"
      show-expand
      expand-strategy="single"
      hover
      fixed-header
      density="comfortable"
      :items-per-page="-1"
      hide-default-footer
      class="min-h-0 flex-1 bg-transparent px-1 sm:px-2 [&_table]:table-fixed [&_thead_th]:bg-surface-container/85 [&_thead_th]:text-label-medium [&_thead_th]:backdrop-blur-lg"
    >
      <template #item.name="{ item }">
        <div class="truncate text-body-medium" :title="item.name ?? item.info_hash">
          {{ item.name ?? item.info_hash }}
        </div>
        <div v-if="stats(item)?.error" class="truncate text-body-small text-error" :title="stats(item)!.error!">
          {{ stats(item)!.error }}
        </div>
      </template>

      <template #item.size="{ item }">
        <span class="text-body-small tabular-nums opacity-70">{{ bytesText(stats(item)?.total_bytes ?? 0) }}</span>
      </template>

      <template #item.progress="{ item }">
        <div class="flex items-center gap-2">
          <v-progress-linear
            :model-value="percentOf(item)"
            :color="TORRENT_STATUS[torrentStatus(item)].color"
            height="6"
            rounded
            class="min-w-0 flex-1"
          />
          <span class="w-9 shrink-0 text-right text-body-small tabular-nums opacity-70">{{ percentOf(item).toFixed(0) }}%</span>
        </div>
      </template>

      <template #item.status="{ item }">
        <v-chip
          size="x-small"
          :color="TORRENT_STATUS[torrentStatus(item)].color"
          :text="TORRENT_STATUS[torrentStatus(item)].text()"
        />
      </template>

      <template #item.speed="{ item }">
        <span class="text-body-small tabular-nums opacity-70">{{ stats(item)?.live?.download_speed.human_readable ?? '—' }}</span>
      </template>

      <template #item.peers="{ item }">
        <span class="text-body-small tabular-nums opacity-70">{{ stats(item)?.live?.snapshot.peer_stats.live ?? 0 }}</span>
      </template>

      <template #item.eta="{ item }">
        <span class="text-body-small tabular-nums opacity-70">{{ stats(item)?.live?.time_remaining?.human_readable ?? '—' }}</span>
      </template>

      <template #item.actions="{ item }">
        <div class="flex items-center justify-end">
          <v-btn icon size="small" variant="text" color="on-surface" @click="play(item)">
            <v-icon :icon="mdiPlayCircleOutline" size="20" />
            <v-tooltip activator="parent" :text="$t('Play')" />
          </v-btn>
          <v-btn
            icon
            size="small"
            variant="text"
            color="on-surface"
            :disabled="stats(item)?.finished"
            @click="toggle(item)"
          >
            <v-icon :icon="stats(item)?.state === 'paused' ? mdiPlay : mdiPause" size="20" />
            <v-tooltip activator="parent" :text="stats(item)?.state === 'paused' ? $t('Resume') : $t('Pause')" />
          </v-btn>
          <v-btn v-if="canReveal" icon size="small" variant="text" color="on-surface" @click="openFolder(item)">
            <v-icon :icon="mdiFolderOpenOutline" size="20" />
            <v-tooltip activator="parent" :text="$t('Open folder')" />
          </v-btn>
          <v-btn icon size="small" variant="text" color="on-surface" @click="removing = item">
            <v-icon :icon="mdiDeleteOutline" size="20" />
            <v-tooltip activator="parent" :text="$t('Remove')" />
          </v-btn>
        </div>
      </template>

      <!-- What's actually inside. Same component the cards use. -->
      <template #expanded-row="{ columns, item }">
        <tr>
          <td :colspan="columns.length" class="!border-b-0 !p-0">
            <div class="mb-2">
              <download-files
                :torrent="item"
                @play="index => play(item, index)"
                @open="file => openFolder(item, file)"
                @notify="message => toast = message"
              />
            </div>
          </td>
        </tr>
      </template>

      <template #no-data>
        <div class="flex flex-col items-center gap-2 py-16">
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
      </template>
    </v-data-table>

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

    <v-snackbar :model-value="!!toast" timeout="2500" @update:model-value="toast = ''">
      {{ toast }}
    </v-snackbar>
  </div>
</template>
