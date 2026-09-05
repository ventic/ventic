<script lang="ts" setup>
import type { CastDevice, CastPlay, CastProblem } from '~/utils/cast'
import { mdiCast, mdiCastConnected, mdiCheck, mdiContentCopy, mdiMagnify, mdiTelevision } from '@mdi/js'

/**
 * "Play this on the television" — the sending half of casting.
 *
 * What it sends is a URL (see utils/cast): this device's engine, mirrored
 * read-only onto the network for as long as the cast lasts, so the other one
 * streams the copy that is already downloaded rather than fetching a second.
 *
 * Devices are found by asking every address on the subnet whether it is a
 * Ventic, and the code typed here is the one the receiving device shows on its
 * own screen — the network is not a permission, and a television anyone on the
 * Wi-Fi can interrupt is not one anybody wants.
 */
const props = defineProps<{
  /** What is playing here — an engine stream, a link, or a path we can't send. */
  src: string
  /**
   * Everything but the URL: which title this is, and where it had got to.
   * Called when the button is pressed rather than passed as a value, so the
   * position is the second on screen and not the second it was last rendered.
   */
  play: () => Omit<CastPlay, 'url'>
}>()

const emit = defineEmits<{ casting: [CastDevice] }>()

const settings = useSettingsStore()

const open = ref(false)
const devices = ref<CastDevice[]>([])
const scanning = ref(false)
const busy = ref(false)
const error = ref<CastProblem | null>(null)

/** Typed in by hand, for a network the sweep can't cover (see `subnet`). */
const address = ref('')
const chosen = ref<CastDevice | null>(null)
const code = ref('')

let hunt: AbortController | null = null

/**
 * The sweep itself, so a cast can wait for it to be *down* rather than merely
 * asked to stop. Aborting is a request: the probes already in Rust's hands end
 * a moment later, and that moment is exactly the one the other device spends
 * opening its connection.
 */
let sweeping: Promise<unknown> | null = null

/** Ticked for a moment after a copy, so the press has an answer. */
const copied = ref(false)

async function copy(command: string) {
  await navigator.clipboard.writeText(command).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

/** A path on this device's own disk is the one thing that can't be cast. */
const sendable = computed(() => castable(props.src))

function pick(device: CastDevice) {
  chosen.value = device
  address.value = device.address
  // The code that worked last time, but only for the device it worked with.
  code.value = settings.castTarget?.address === device.address ? settings.castTarget.code : ''
}

async function scan() {
  hunt?.abort()
  hunt = new AbortController()
  const signal = hunt.signal

  error.value = null
  // The one it was cast to last time is offered before the sweep has found
  // anything — it is nearly always the one meant again, and a list that starts
  // empty every time makes casting twice as slow as casting once. Re-seeded
  // here rather than kept, because a sweep that finds it fills in its real name.
  const last = settings.castTarget
  devices.value = last ? [{ name: last.name, address: last.address }] : []

  const self = await castAddress()
  if (!self) {
    error.value = { message: $t('This device isn\'t on a network Ventic can see. Type the other device\'s address instead.') }
    return
  }

  scanning.value = true
  try {
    sweeping = findDevices(self, device => {
      if (!devices.value.some(known => known.address === device.address))
        devices.value.push(device)
    }, signal)
    await sweeping
  }
  finally {
    if (!signal.aborted)
      scanning.value = false
  }
}

async function start() {
  const device = chosen.value?.address === address.value
    ? chosen.value
    : address.value.trim() ? { name: address.value.trim(), address: address.value.trim() } : null

  if (!device || busy.value)
    return

  // Stop sweeping first. 253 addresses are 253 connections this device is
  // opening while the other one is trying to pull the first megabyte of a film
  // *from* it, and the stream is what loses: the television sat on a spinner
  // until its own 15-second leash ran out. Waiting for the sweep to finish
  // before pressing Play was the workaround people found by themselves — this
  // is that, minus the waiting. Nothing needs finding once a device is picked.
  hunt?.abort()
  scanning.value = false
  // And wait for it to actually be down. `abort` only stops the loop handing out
  // more addresses; what competes with the other device is the handful already
  // in flight, which is why pressing Play the moment the dialog opens behaved
  // differently from pressing it once the list had filled.
  await sweeping?.catch(() => {})
  sweeping = null

  busy.value = true
  error.value = null
  // Turning the mirror on is the one part worth undoing if this fails: it opens
  // a port, and a cast that never happened should not leave one open.
  const wasSharing = await sharingEngine()
  try {
    const base = await shareEngine(true)
    const url = base ? castUrl(props.src, base) : null
    if (!url) {
      error.value = {
        message: base
          ? $t('A file from this device\'s own disk can\'t be cast — the other device has no way to open it.')
          : $t('This device couldn\'t start serving the film to the network.'),
      }
      return
    }

    const problem = await sendPlay(device, code.value.trim(), { ...props.play(), url })
    if (problem) {
      error.value = problem
      return
    }

    settings.castTarget = { ...device, code: code.value.trim() }
    open.value = false
    emit('casting', device)
  }
  catch (e) {
    error.value = { message: e instanceof Error ? e.message : String(e) }
  }
  finally {
    if (error.value && !wasSharing)
      await shareEngine(false).catch(() => {})
    busy.value = false
  }
}

watch(open, is => {
  if (!is) {
    hunt?.abort()
    scanning.value = false
    return
  }

  error.value = null
  chosen.value = null
  address.value = ''
  code.value = ''

  if (settings.castTarget)
    pick(settings.castTarget)
  scan()
})

onBeforeUnmount(() => hunt?.abort())
</script>

<template>
  <v-btn
    v-if="sendable"
    icon
    variant="text"
    density="comfortable"
    :title="$t('Play on another device')"
    @click="open = true"
  >
    <v-icon :icon="mdiCast" />
  </v-btn>

  <v-dialog v-model="open" max-width="520">
    <!-- flat: over mpv this card is a hole cut in the video window, and a
         shadow would be sliced off at its edge (see MpvPlayer's `CUT`). -->
    <v-card flat rounded="xl">
      <v-card-title class="text-title-medium">
        {{ $t('Play on another device') }}
      </v-card-title>

      <v-card-text class="flex flex-col gap-4">
        <p class="text-body-medium opacity-70">
          {{ $t('The other device streams this film from here, so nothing is downloaded twice. Both have to be on the same network, and it has to be switched on for casting under Settings → Network.') }}
        </p>

        <div>
          <div class="text-label-medium mb-1 flex items-center gap-2 opacity-70">
            <v-icon :icon="mdiTelevision" size="18" />
            {{ $t('Devices on this network') }}
            <v-progress-circular v-if="scanning" indeterminate size="14" width="2" />
          </div>

          <v-list v-if="devices.length" density="comfortable" class="rounded-lg bg-surface-container-high">
            <v-list-item
              v-for="device in devices"
              :key="device.address"
              :active="chosen?.address === device.address"
              :title="device.name"
              :subtitle="device.address"
              @click="pick(device)"
            />
          </v-list>

          <!-- The one failure that isn't a failure: a device nobody switched
               on. Said as an alert rather than a grey line, because it is the
               first thing to check and the fix is on the other screen. -->
          <v-alert v-else-if="!scanning" type="info" variant="tonal" density="compact" class="text-body-small">
            {{ $t('Nothing answered. On the other device, switch on Settings → Network → “Let other devices play films on this one”, then search again — or type its address below.') }}
          </v-alert>
        </div>

        <tv-field :label="$t('Address')">
          <v-text-field
            v-model="address"
            :label="$t('Address')"
            placeholder="192.168.1.42"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </tv-field>

        <tv-field :label="$t('Pairing code')">
          <v-text-field
            v-model="code"
            :label="$t('Pairing code')"
            :hint="$t('Shown on the other device, under Settings → Network. Leave it empty if that device doesn\'t ask for one.')"
            persistent-hint
            density="comfortable"
            variant="outlined"
            inputmode="numeric"
            maxlength="8"
          />
        </tv-field>

        <div v-if="error" class="flex flex-col gap-2">
          <p class="text-body-small text-error">
            {{ error.message }}
          </p>

          <!-- The failure with a one-line fix. Shown as the command itself
               because the alternative is the user going to look up their
               firewall's syntax, which is where most of them stop. -->
          <template v-if="error.command">
            <div class="text-label-medium opacity-70">
              {{ $t('Run this, then try again:') }}
            </div>
            <div class="flex items-center gap-2 rounded-lg bg-surface-container-high px-3 py-2">
              <code class="min-w-0 flex-1 select-text overflow-x-auto whitespace-pre text-body-small">{{ error.command }}</code>
              <v-btn
                icon
                variant="text"
                density="comfortable"
                :title="$t('Copy')"
                @click="copy(error.command)"
              >
                <v-icon :icon="copied ? mdiCheck : mdiContentCopy" size="18" />
              </v-btn>
            </div>
          </template>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" :prepend-icon="mdiMagnify" :disabled="scanning" @click="scan">
          {{ $t('Search again') }}
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="open = false">
          {{ $t('Cancel') }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :prepend-icon="mdiCastConnected"
          :loading="busy"
          :disabled="!address.trim()"
          @click="start"
        >
          {{ $t('Play there') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
