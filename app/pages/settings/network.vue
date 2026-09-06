<script setup lang="ts">
import { mdiCast, mdiRefresh, mdiStop } from '@mdi/js'

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

/**
 * Turning either casting switch on has to leave a code behind: a device asking
 * for one it hasn't got answers nothing at all (see plugins/cast.client.ts).
 * Minted here rather than whenever the box is empty — that rewrites the field
 * under somebody clearing it to type a number they can actually remember.
 */
function arm() {
  if (settings.castReceive && settings.castAsk && !settings.castCode)
    settings.castCode = newCode()
}

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

/**
 * The limits on offer. Stops rather than a range: nobody wants 3.5 MiB/s, and
 * a hundred half-megabyte steps is what made this a slider a remote couldn't
 * cross. A value saved by that slider starts from the nearest stop.
 */
const LIMITS = [0, 0.5, 1, 2, 5, 10, 20, 50]

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
      <settings-row :label="$t('Download')">
        <settings-stepper v-model="settings.downLimit" :values="LIMITS" :format="label" />
      </settings-row>
      <settings-row :label="$t('Upload')">
        <settings-stepper v-model="settings.upLimit" :values="LIMITS" :format="label" />
      </settings-row>

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
        @update:model-value="arm"
      />

      <template v-if="settings.castReceive">
        <tv-field :label="$t('This device is called')">
          <v-text-field
            v-model="settings.castName"
            :label="$t('This device is called')"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </tv-field>

        <v-switch
          v-model="settings.castAsk"
          color="primary"
          density="comfortable"
          hide-details
          :label="$t('Ask for a pairing code')"
          @update:model-value="arm"
        />

        <!-- The code is editable, not just re-rollable: four random digits are
             four digits nobody remembers, and the one thing this guards is a
             television in your own front room. Any length, so a household can
             use a number it already knows. -->
        <div v-if="settings.castAsk" class="flex flex-wrap items-start gap-3">
          <tv-field :label="$t('Pairing code')" class="min-w-48 flex-1">
            <v-text-field
              v-model.trim="settings.castCode"
              :label="$t('Pairing code')"
              density="comfortable"
              variant="outlined"
              inputmode="numeric"
              maxlength="8"
              autocomplete="off"
              spellcheck="false"
              hide-details
            />
          </tv-field>
          <v-btn variant="text" class="mt-2" :prepend-icon="mdiRefresh" @click="settings.castCode = newCode()">
            {{ $t('New code') }}
          </v-btn>
        </div>

        <div>
          <div class="text-headline-small tabular-nums">
            {{ address || '—' }}
          </div>
          <div class="text-label-medium opacity-70">
            {{ $t('Address on this network') }}
          </div>
        </div>

        <p v-if="settings.castAsk" class="text-body-medium opacity-70">
          {{ $t('Type these into the other device when it asks. The code is what stops anyone else on this network putting something on your screen, so it never travels in a backup.') }}
        </p>
        <p v-else class="text-body-medium text-warning">
          {{ $t('Without a code, anything on this network can play a film on this screen — fine at home, worth switching back on anywhere else.') }}
        </p>

        <!-- An empty code with the switch on answers nothing and looks like a
             device that has simply stopped working. -->
        <p v-if="settings.castAsk && !settings.castCode" class="text-body-small text-error">
          {{ $t('Set a code, or turn the code off — this device answers nothing until one of the two is true.') }}
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
