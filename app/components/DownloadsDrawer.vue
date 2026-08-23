<script setup lang="ts">
import { mdiArrowLeft, mdiArrowUp, mdiMagnetOn, mdiTrayArrowDown } from '@mdi/js'

const ui = useUiStore()
const downloads = useDownloadsStore()
const { mobile } = useDisplay()

const open = computed({
  get: () => !mobile.value || ui.drawer,
  set: value => (ui.drawer = value),
})

const adding = ref(false)
const magnet = ref('')
const error = ref('')
const busy = ref(false)

/**
 * A hand-pasted magnet is added whole — unlike the app's own downloads, which
 * narrow to the one file being watched. The file list is where you trim it.
 */
async function add() {
  busy.value = true
  error.value = ''
  try {
    await addTorrent(magnet.value.trim())
    await downloads.refresh()
    adding.value = false
    magnet.value = ''
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    busy.value = false
  }
}

function mbps(value: number) {
  return $t('{rate} MiB/s', { rate: value.toFixed(1) })
}
</script>

<template>
  <v-navigation-drawer
    v-model="open"
    :width="228"
    :permanent="!mobile"
    :temporary="mobile"
    class="panel border-none"
  >
    <nuxt-link :to="localePath('/')" class="flex items-center gap-3 px-4 py-5">
      <v-icon :icon="mdiArrowLeft" size="22" />
      <span class="text-title-medium whitespace-nowrap">{{ $t('Transfers') }}</span>
    </nuxt-link>

    <v-list nav density="comfortable" class="px-2">
      <v-list-item
        v-for="item in FILTERS"
        :key="item.value"
        :prepend-icon="item.icon"
        :title="item.title()"
        :active="downloads.filter === item.value"
        color="primary"
        rounded="lg"
        @click="downloads.filter = item.value"
      >
        <template #append>
          <span class="text-body-small opacity-60">{{ downloads.counts[item.value] }}</span>
        </template>
      </v-list-item>
    </v-list>

    <template #append>
      <div class="flex flex-col gap-2 p-3">
        <div class="flex items-center justify-between px-1 text-body-small opacity-60">
          <span class="flex items-center gap-1">
            <v-icon :icon="mdiTrayArrowDown" size="14" />{{ mbps(downloads.speed.down) }}
          </span>
          <span class="flex items-center gap-1">
            <v-icon :icon="mdiArrowUp" size="14" />{{ mbps(downloads.speed.up) }}
          </span>
        </div>
        <v-btn :prepend-icon="mdiMagnetOn" block variant="tonal" @click="adding = true">
          {{ $t('Add magnet') }}
        </v-btn>
      </div>
    </template>

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
          <div v-if="error" class="pt-2 text-body-small text-error">
            {{ error }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" size="small" @click="adding = false">
            {{ $t('Cancel') }}
          </v-btn>
          <v-btn
            variant="tonal"
            size="small"
            :loading="busy"
            :disabled="!magnet.trim()"
            @click="add"
          >
            {{ $t('Add') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-navigation-drawer>
</template>
