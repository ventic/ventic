<script setup lang="ts">
import type { MediaType } from '~/utils/tmdb'
import type { Release } from '~/utils/torrents'
import {
  mdiAccountGroup,
  mdiAlertCircleOutline,
  mdiCheck,
  mdiDownload,
  mdiFlashOutline,
  mdiFormatListBulletedType,
  mdiPlay,
  mdiPowerPlugOutline,
  mdiReload,
  mdiWeightLifter,
} from '@mdi/js'

/**
 * Every release the configured sources offer for a title, when the automatic
 * pick isn't what you want — a 4k copy, a specific release group, or just more
 * seeders. With no sources configured there is nothing to search, and the
 * dialog says so rather than showing an empty list.
 */
const props = defineProps<{
  type: MediaType
  id: string | number
  imdbId?: string | null
  season?: number
  episode?: number
}>()

const downloads = useDownloadsStore()
const settings = useSettingsStore()

const open = ref(false)
const torrents = ref<Release[]>([])
const pending = ref(false)
const error = ref('')
const busy = ref('')
const added = ref<string[]>([])

const tier = ref('all')
const query = ref('')
const sort = ref<'seeders' | 'size'>('seeders')

/** Nothing to search until the user has added somewhere to search. */
const configured = computed(() => settings.sources.length > 0)

async function load() {
  if (!configured.value) {
    error.value = NO_SOURCES()
    return
  }
  if (!props.imdbId) {
    error.value = $t('TMDB has no IMDb id for this title, so there is nothing to look it up with.')
    return
  }
  pending.value = true
  error.value = ''
  try {
    torrents.value = await findReleases(props.imdbId, props.season, props.episode)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    pending.value = false
  }
}

// Only search once the dialog is actually opened, and again if the episode changed.
watch(open, value => value && !torrents.value.length && load())
watch(() => [props.imdbId, props.season, props.episode].join('|'), () => {
  torrents.value = []
  added.value = []
})

/** "4k DV | HDR" and "4k HDR" are one tier as far as picking goes. */
function tierOf(t: Release) {
  return t.quality.split(' ')[0] || 'other'
}

const tiers = computed(() => ['all', ...new Set(torrents.value.map(tierOf))])

// Same pick the Play button would make, storage budget included — picking by
// hand can still exceed it, and eviction will make room.
const best = computed(() => pickBest(torrents.value, downloads.budget))

/**
 * Too big for the drive to hold at all — a FAT32 stick stops at 4 GiB. Unlike
 * the budget, no amount of eviction makes room for one of these, so the row is
 * disabled rather than merely marked: the download would run to the 4 GiB mark
 * and die there.
 *
 * A direct link is exempt, as everywhere else: nothing of it touches the disk.
 */
function tooBig(t: Release) {
  return !t.url && t.bytes > downloads.fileLimit
}

const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  return torrents.value
    .filter(t => (tier.value === 'all' || tierOf(t) === tier.value)
      && (!q || `${t.name} ${t.source}`.toLowerCase().includes(q)))
    .sort((a, b) => sort.value === 'size' ? a.bytes - b.bytes : b.seeders - a.seeders)
})

function playLink(t: Release) {
  const param = t.url ? `url=${encodeURIComponent(t.url)}` : `magnet=${encodeURIComponent(t.magnet)}`
  return `${watchLink(props.type, props.id, props.season, props.episode)}&${param}`
}

async function download(t: Release) {
  busy.value = releaseKey(t)
  error.value = ''
  try {
    // Filed under the title, so this is the copy its Play button uses from now
    // on — picking a release by hand is a decision, not a one-off.
    await downloads.start(
      progressKey(props.type, props.id, props.season, props.episode),
      { magnet: t.magnet, season: props.season, episode: props.episode },
    )
    added.value = [...added.value, releaseKey(t)]
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    busy.value = ''
  }
}
</script>

<template>
  <v-btn :prepend-icon="mdiFormatListBulletedType" variant="tonal" :disabled="!imdbId" @click="open = true">
    {{ $t('Releases') }}

    <v-dialog v-model="open" max-width="1000" scrollable>
      <v-card rounded="xl">
        <v-card-title class="flex items-center gap-3 text-title-medium">
          <span>{{ $t('Pick a release') }}</span>
          <span v-if="torrents.length" class="text-body-small opacity-55">
            {{ $t('{shown} of {total}', { shown: list.length, total: torrents.length }) }}
          </span>
          <v-spacer />
          <v-btn icon size="small" variant="text" color="on-surface" :loading="pending" @click="load">
            <v-icon :icon="mdiReload" size="20" />
            <v-tooltip activator="parent" :text="$t('Search again')" />
          </v-btn>
        </v-card-title>

        <div class="flex flex-wrap items-center gap-2 px-4 pb-3">
          <div class="min-w-0 w-full sm:w-auto sm:flex-1">
            <v-chip-group v-model="tier" mandatory selected-class="bg-primary text-on-primary font-medium">
              <v-chip v-for="value in tiers" :key="value" :value="value" :text="value" size="small" />
            </v-chip-group>
          </div>
          <!-- Parked behind a press like every other filter box: a remote walks
               this row to reach the sort dropdown, and a field that merely has
               focus raises Android's keyboard over the whole dialog. -->
          <search-field
            v-model="query"
            :placeholder="$t('Release or origin')"
            class="min-w-40 flex-1 shrink-0 sm:w-56 sm:flex-none sm:grow-0"
          />
          <v-select
            v-model="sort"
            :items="[
              { value: 'seeders', title: $t('Most seeders') },
              { value: 'size', title: $t('Smallest') },
            ]"
            density="compact"
            hide-details
            class="w-40 shrink-0 grow-0"
          />
        </div>

        <v-card-text class="max-h-[60vh] pt-0">
          <div v-if="!configured" class="flex flex-col items-center gap-3 py-10 text-center">
            <v-icon :icon="mdiPowerPlugOutline" size="36" class="opacity-40" />
            <span class="max-w-md text-body-medium opacity-70">
              {{ $t('Ventic has no sources configured, so there is nowhere to search. You can still play a magnet or a torrent file you open yourself.') }}
            </span>
            <v-btn variant="tonal" size="small" :to="localePath('/settings/sources')">
              {{ $t('Open source settings') }}
            </v-btn>
          </div>

          <div v-else-if="error" class="flex flex-col items-center gap-2 py-10">
            <v-icon :icon="mdiAlertCircleOutline" color="error" size="36" />
            <span class="text-body-medium opacity-70">{{ error }}</span>
          </div>

          <div v-else-if="pending && !torrents.length" class="flex flex-col items-center gap-2 py-10">
            <v-progress-circular indeterminate color="primary" />
            <span class="text-body-small opacity-55">{{ $t('Searching your sources…') }}</span>
          </div>

          <div v-else-if="!list.length" class="py-10 text-center text-body-medium opacity-60">
            {{ $t('Nothing matches.') }}
          </div>

          <div v-else class="flex flex-col gap-1">
            <!-- The columns add up to more than a phone is wide, so `basis-full`
                 gives the release name its own line there and the rest of the
                 numbers flow underneath it. -->
            <div
              v-for="t in list"
              :key="releaseKey(t)"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 hover:bg-surface-container-high/60 focus-within:bg-surface-container-high/60"
              :class="tooBig(t) ? 'opacity-45' : ''"
            >
              <div class="min-w-0 flex-1 basis-full sm:basis-0">
                <div class="flex items-center gap-2">
                  <span class="truncate text-body-medium" :title="t.name">{{ t.name }}</span>
                  <v-chip v-if="best && releaseKey(t) === releaseKey(best)" size="x-small" color="primary" :text="$t('Best')" class="shrink-0" />
                </div>
                <!-- Season packs name the episode here and nowhere else. -->
                <div v-if="t.file" class="truncate text-body-small opacity-50" :title="t.file">
                  {{ t.file }}
                </div>
              </div>

              <v-chip size="x-small" :text="t.quality || $t('unknown')" class="shrink-0" />

              <!-- Amber is "costs more than it's worth", error is "will not fit
                   at all" — the second has to outrank the first, since a bloated
                   release is usually also the oversized one. -->
              <span
                class="shrink-0 text-body-small sm:w-20 sm:text-right"
                :class="tooBig(t) ? 'text-error' : isBloated(t) ? 'text-warning' : 'opacity-70'"
              >
                {{ t.size || bytesText(t.bytes) }}
                <v-tooltip
                  v-if="tooBig(t)"
                  activator="parent"
                  :text="$t('Over the {limit} single-file limit of the drive downloads go to — reformat it in Settings → Storage to use releases this big', { limit: bytesText(downloads.fileLimit) })"
                />
                <v-tooltip v-else-if="isBloated(t)" activator="parent" :text="$t('Bigger than this quality needs — may not keep up while streaming')" />
              </span>

              <!-- A link has no swarm, so this column says what it is instead. -->
              <span
                class="flex shrink-0 items-center gap-1 text-body-small sm:w-16 sm:justify-end"
                :class="t.url ? 'text-primary' : 'opacity-70'"
              >
                <template v-if="t.url">
                  <v-icon :icon="mdiFlashOutline" size="13" />{{ $t('Direct') }}
                  <v-tooltip activator="parent" :text="$t('The source fetched this already — it plays at once and keeps nothing on this device')" />
                </template>
                <template v-else>
                  <v-icon :icon="mdiAccountGroup" size="13" />{{ t.seeders }}
                </template>
              </span>

              <span class="hidden w-24 shrink-0 truncate text-body-small opacity-50 sm:block">{{ t.source }}</span>

              <div class="ml-auto flex shrink-0 items-center sm:ml-0">
                <!-- Playing is downloading here, so an oversized release is as
                     dead on Play as it is on Download. -->
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="on-surface"
                  :disabled="tooBig(t)"
                  :to="tooBig(t) ? undefined : playLink(t)"
                >
                  <v-icon :icon="mdiPlay" size="20" />
                  <v-tooltip activator="parent" :text="tooBig(t) ? $t('Too big for the download drive') : $t('Play this source')" />
                </v-btn>
                <!-- Nothing to hand the engine for a link, and nothing it could
                     keep — the file lives on the source's server, not in a swarm. -->
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="on-surface"
                  :disabled="!!t.url || tooBig(t)"
                  :loading="busy === releaseKey(t)"
                  @click="download(t)"
                >
                  <v-icon :icon="added.includes(releaseKey(t)) ? mdiCheck : mdiDownload" size="20" />
                  <v-tooltip
                    activator="parent"
                    :text="tooBig(t) ? $t('Too big for the download drive') : added.includes(releaseKey(t)) ? $t('In downloads') : $t('Download')"
                  />
                </v-btn>
              </div>
            </div>
          </div>
        </v-card-text>

        <v-card-actions>
          <!-- One legend at a time, and a drive that cannot hold the release
               outranks a release that is merely fatter than it needs to be.
               Shown at every width, unlike the amber note: a dimmed row with no
               explanation reads as the app being broken. -->
          <span v-if="list.some(tooBig)" class="flex items-center gap-1 pl-2 text-body-small text-error">
            <v-icon :icon="mdiAlertCircleOutline" size="14" />
            {{ $t('Dimmed rows are over the {limit} file limit of the download drive.', { limit: bytesText(downloads.fileLimit) }) }}
          </span>
          <!-- The legend is the first thing to go when the row gets tight; the
               amber itself still carries a tooltip. -->
          <span v-else class="hidden items-center gap-1 pl-2 text-body-small opacity-45 sm:flex">
            <v-icon :icon="mdiWeightLifter" size="14" />
            {{ $t('Sizes in amber cost more bandwidth than the picture is worth.') }}
          </span>
          <v-spacer />
          <v-btn variant="text" size="small" :to="localePath('/downloads')">
            {{ $t('Downloads') }}
          </v-btn>
          <v-btn variant="text" size="small" @click="open = false">
            {{ $t('Close') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-btn>
</template>
