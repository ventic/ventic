<script setup lang="ts">
import { mdiArrowUp, mdiTrayArrowDown } from '@mdi/js'

const settings = useSettingsStore()
const downloads = useDownloadsStore()

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
