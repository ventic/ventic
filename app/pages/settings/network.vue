<script setup lang="ts">
import { mdiArrowUp, mdiCast, mdiRefresh, mdiStop, mdiTrayArrowDown } from '@mdi/js'

const settings = useSettingsStore()
const downloads = useDownloadsStore()

/**
 * Casting is two unrelated switches that happen to share a screen: whether this
 * device *answers* other devices, and whether it is *serving* a film to one
 * right now. The first is a setting; the second is a state the player put it
 * in, and this is where it can be put back — the phone that cast is usually in
 * a pocket by then.
 */
const address = ref('')
const sharing = ref(false)

onMounted(async () => {
  address.value = await castAddress()
  sharing.value = await sharingEngine()
})

/** Why the last Stop didn't fully land, for the screen it was pressed on. */
const stopped = ref('')

/**
 * The Stop that matters. Leaving the player is the ordinary way to use a cast,
 * and the player's own button goes with it — so this is where a cast is stopped
 * most of the time, and it has to do the whole job: tell the other device to
 * leave the film, then stop serving it.
 */
async function stopSharing() {
  const problem = await stopCast(settings.castTarget)
  stopped.value = problem?.message ?? ''
  sharing.value = false
  // The film was left focused so it would keep feeding the other device — see
  // `onBeforeUnmount` in pages/watch.vue. This is where that is handed back.
  await downloads.release()
}

/**
 * Only Android can tell a metered network from a free one, so only there is
 * there a setting to make about it (see `meteredNetwork`).
 */
const canMeter = meteredNetwork() !== null

/** MiB/s, matching what the engine reports and the downloads drawer shows. */
function label(value: number) {
  return value > 0 ? $t('{rate} MiB/s', { rate: value }) : $t('Automatic')
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Speed limits')"
      :hint="$t('Applied to peer traffic across every torrent. Zero hands the decision back to the app, which leaves downloads unlimited and works the seeding ceiling out from the fastest upload this connection has managed.')"
    >
      <div>
        <div class="text-label-medium flex items-center gap-2 opacity-70">
          <v-icon :icon="mdiTrayArrowDown" size="18" /> {{ $t('Download') }} · {{ label(settings.downLimit) }}
        </div>
        <v-slider v-model="settings.downLimit" :min="0" :max="50" :step="0.5" thumb-label />
      </div>

      <div>
        <div class="text-label-medium flex items-center gap-2 opacity-70">
          <v-icon :icon="mdiArrowUp" size="18" /> {{ $t('Upload') }} · {{ label(settings.upLimit) }}
        </div>
        <v-slider v-model="settings.upLimit" :min="0" :max="50" :step="0.5" thumb-label />
      </div>

      <p class="text-body-small opacity-70">
        {{ $t('A limit you set here holds during playback too, where the automatic ceiling would otherwise drop seeding to a quarter of the line so the stream keeps up.') }}
      </p>
    </settings-section>

    <settings-section
      v-if="canMeter"
      :title="$t('Mobile data')"
      :hint="$t('Downloads keep running when the app is off screen, which is worth knowing about on a connection that charges for bytes.')"
    >
      <v-switch
        v-model="settings.wifiOnly"
        color="primary"
        density="comfortable"
        hide-details
        :label="$t('Only download on Wi-Fi')"
      />
      <p class="text-body-medium opacity-70">
        {{ $t('Downloads pause on mobile data or a metered hotspot, and start again on Wi-Fi. A film you pressed play on keeps streaming either way — that is data you asked for. On Wi-Fi again with the app closed, downloads resume the next time you open it.') }}
      </p>
      <p class="text-body-medium">
        {{ downloads.metered
          ? $t('This connection is metered right now.')
          : $t('This connection is not metered right now.') }}
      </p>
    </settings-section>

    <settings-section
      :title="$t('Casting')"
      :hint="$t('Play a film from one device on another one on this network. The film streams from the device that already has it, so nothing is downloaded twice and no account or server is involved.')"
    >
      <v-switch
        v-model="settings.castReceive"
        color="primary"
        density="comfortable"
        hide-details
        :label="$t('Let other devices play films on this one')"
      />

      <template v-if="settings.castReceive">
        <v-text-field
          v-model="settings.castName"
          :label="$t('This device is called')"
          density="comfortable"
          variant="outlined"
          hide-details
        />

        <div class="flex flex-wrap items-end gap-6">
          <div>
            <div class="text-headline-small tabular-nums">
              {{ settings.castCode || '—' }}
            </div>
            <div class="text-label-medium opacity-70">
              {{ $t('Pairing code') }}
            </div>
          </div>
          <div>
            <div class="text-headline-small tabular-nums">
              {{ address || '—' }}
            </div>
            <div class="text-label-medium opacity-70">
              {{ $t('Address on this network') }}
            </div>
          </div>
          <v-btn variant="text" :prepend-icon="mdiRefresh" @click="settings.castCode = newCode()">
            {{ $t('New code') }}
          </v-btn>
        </div>

        <p class="text-body-medium opacity-70">
          {{ $t('Type these into the other device when it asks. The code is what stops anyone else on this network putting something on your screen, so it never travels in a backup.') }}
        </p>
      </template>

      <div v-if="sharing" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-3">
          <p class="text-body-medium">
            <v-icon :icon="mdiCast" size="18" class="mr-1" />
            {{ settings.castTarget
              ? $t('This device is streaming a film to {device} right now.', { device: settings.castTarget.name })
              : $t('This device is streaming a film to another one right now.') }}
          </p>
          <v-btn variant="tonal" :prepend-icon="mdiStop" @click="stopSharing">
            {{ $t('Stop casting') }}
          </v-btn>
        </div>
        <p class="text-body-small opacity-70">
          {{ $t('Stopping tells the other device to leave the film, then stops serving it from here.') }}
        </p>
      </div>

      <p v-else-if="stopped" class="text-body-small text-error">
        {{ stopped }}
      </p>
    </settings-section>

    <settings-section :title="$t('Right now')" :hint="$t('Live totals from the torrent engine.')">
      <div class="flex flex-wrap gap-6">
        <div>
          <div class="text-headline-small tabular-nums">
            {{ downloads.speed.down.toFixed(1) }} <span class="text-body-medium opacity-70">MiB/s</span>
          </div>
          <div class="text-label-medium opacity-70">
            {{ $t('Download') }}
          </div>
        </div>
        <div>
          <div class="text-headline-small tabular-nums">
            {{ downloads.speed.up.toFixed(1) }} <span class="text-body-medium opacity-70">MiB/s</span>
          </div>
          <div class="text-label-medium opacity-70">
            {{ $t('Upload') }}
          </div>
        </div>
        <div>
          <div class="text-headline-small tabular-nums">
            {{ downloads.counts.all }}
          </div>
          <div class="text-label-medium opacity-70">
            {{ $t('Torrents') }} · {{ downloads.offline ? $t('engine offline') : $t('engine running') }}
          </div>
        </div>
      </div>
    </settings-section>
  </div>
</template>
