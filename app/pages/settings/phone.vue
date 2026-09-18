<script setup lang="ts">
/**
 * The phone as this device's keyboard.
 *
 * Adding a source means typing a web address, which is the one thing a remote
 * is worst at — so the television shows a code, the phone opens a form, and
 * what it sends lands here as a question (`SetupDialog`). The page the phone
 * opens is served by the cast receiver itself (`setup_page` in cast.rs): one
 * more route on a port that already exists, rather than a second server.
 *
 * `ui.pairing` is what holds that port open, and only while this screen is up.
 */
import { mdiWifiOff } from '@mdi/js'
import { encode } from 'uqr'

const settings = useSettingsStore()
const ui = useUiStore()

const address = ref('')
const started = ref(false)

onMounted(async () => {
  // A device already taking casts keeps answering to the code it already has:
  // a fresh one here would refuse the film somebody is handing it at the same
  // moment. One that isn't gets a code of its own for as long as this is open.
  ui.pairing = settings.castReceive ? (settings.castAsk ? settings.castCode : '') : newCode()
  started.value = true
  address.value = await castAddress()
})

// The port goes with the screen. Leaving is how you stop serving the form —
// there is nothing to switch off and nothing left listening.
onUnmounted(() => ui.pairing = null)

/** The port wouldn't open (see `apply` in plugins/cast.client.ts). */
const failed = computed(() => started.value && ui.pairing === null)

const url = computed(() => setupUrl(address.value, ui.pairing ?? ''))

/**
 * The code as one SVG path — a rect per module is 700 elements, and this is a
 * television. Drawn rather than pulled in as markup: `v-html` on a generated
 * string is a habit worth not having.
 */
const qr = computed(() => {
  const { size, data } = encode(url.value)
  let d = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y]![x])
        d += `M${x} ${y}h1v1h-1z`
    }
  }
  return { size, d }
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Use your phone')"
      :hint="$t('Typing an address with a remote is the worst part of setting this up. Point a phone\'s camera at the code and a small page opens on it — what you type there arrives here, and this screen asks before it keeps any of it.')"
      :keywords="$t('QR code, scan, pair, phone keyboard, type on phone, onboarding, remote, setup')"
    >
      <v-alert v-if="failed" type="warning" variant="tonal" density="comfortable" rounded="lg" :text="$t('Ventic couldn\'t open the port this needs. Something else on this device may already be using it.')" />

      <div v-else-if="!address" class="flex flex-col items-center gap-2 rounded-lg bg-surface-container/40 px-4 py-10 text-center">
        <v-icon :icon="mdiWifiOff" size="32" class="opacity-40" />
        <p class="text-body-medium opacity-70">
          {{ $t('This device has no address on a network, so there is nothing for a phone to open. Connect it to the same Wi-Fi as the phone.') }}
        </p>
      </div>

      <div v-else class="flex flex-wrap items-center gap-8">
        <!-- White behind it whatever the theme is: a reader wants the contrast
             it was designed for, and a dark QR on a dark surface scans badly. -->
        <div class="rounded-xl bg-white p-4">
          <svg :viewBox="`0 0 ${qr.size} ${qr.size}`" class="block h-56 w-56" shape-rendering="crispEdges" role="img" :aria-label="url">
            <path :d="qr.d" fill="#000" />
          </svg>
        </div>

        <div class="flex flex-col gap-5">
          <div>
            <p class="text-body-small opacity-70">
              {{ $t('Or open this in a browser on the phone') }}
            </p>
            <p class="text-headline-small break-all">
              {{ `${address}:${CAST_PORT}` }}
            </p>
          </div>
          <div v-if="ui.pairing">
            <p class="text-body-small opacity-70">
              {{ $t('and type this code when it asks') }}
            </p>
            <p class="text-display-small tracking-[0.3em]">
              {{ ui.pairing }}
            </p>
          </div>
        </div>
      </div>

      <p class="text-body-small opacity-70">
        {{ $t('Both devices have to be on the same network. The page is only served while this screen is open, and the code is what stops anyone else on the Wi-Fi from sending anything.') }}
      </p>
      <p class="text-body-small opacity-70">
        {{ $t('You can send a source, a Live TV playlist, an Xtream login, or the WebDAV folder to sync your library with.') }}
      </p>
    </settings-section>
  </div>
</template>
