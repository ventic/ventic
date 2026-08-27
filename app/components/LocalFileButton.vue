<script setup lang="ts">
import type { MediaType } from '~/utils/tmdb'
import { mdiFolderPlay, mdiFolderPlayOutline } from '@mdi/js'

/**
 * Play a film you already own, off this machine's own disk.
 *
 * The app never goes looking for one: there is no folder to scan, no filename
 * to parse and nothing to match, because you point at the file yourself from a
 * title you have already found. Attaching it is what links the two, and from
 * then on it is what Play uses — so progress, history, favourites and the
 * watchlist all work exactly as they do for anything else, with no sources
 * configured and no network at all.
 *
 * Desktop only. mpv opens a path; the webview's `<video>` that Android and the
 * browser fall back to cannot, and Android's answer would be a content URI
 * through SAF rather than a path.
 */
const props = defineProps<{
  type: MediaType
  id: string | number
  season?: number
  episode?: number
  size?: string
}>()

const downloads = useDownloadsStore()

// The question is whether the thing that plays this can open a path at all,
// which is exactly what `native` means in MpvPlayer.
const native = hasNativePlayer()

const key = computed(() => progressKey(props.type, props.id, props.season, props.episode))
const path = computed(() => downloads.localFor(key.value))

/** Just the file name: a full path is wider than the menu it sits in. */
const name = computed(() => path.value.split(/[/\\]/).pop() ?? '')

async function choose() {
  const picked = await useTauriDialogOpen({
    title: $t('Choose a video file'),
    multiple: false,
    directory: false,
    filters: [{ name: $t('Video'), extensions: [...VIDEO_EXTENSIONS] }],
  })
  // Cancelled: null here, and on some platforms an empty selection.
  if (typeof picked === 'string')
    downloads.setLocal(key.value, picked)
}
</script>

<template>
  <template v-if="native">
    <v-btn
      v-if="!path"
      icon
      variant="text"
      color="on-surface"
      :size="size"
      @click="choose"
    >
      <v-icon :icon="mdiFolderPlayOutline" />
      <v-tooltip activator="parent" :text="$t('Play a file from this computer')" />
    </v-btn>

    <!-- Attached: the same button, but now it also has to be possible to point
         it somewhere else or forget the file — a path that has moved otherwise
         breaks Play for good with no way back to searching. -->
    <v-btn v-else icon variant="text" color="primary" :size="size">
      <v-icon :icon="mdiFolderPlay" />
      <v-menu activator="parent">
        <v-list density="compact">
          <v-list-subheader class="text-body-small opacity-70">
            {{ name }}
          </v-list-subheader>
          <v-list-item :title="$t('Choose another file…')" @click="choose" />
          <v-list-item :title="$t('Forget this file')" @click="downloads.setLocal(key, '')" />
        </v-list>
      </v-menu>
    </v-btn>
  </template>
</template>
