<script setup lang="ts">
import { mdiBackspaceOutline } from '@mdi/js'

/**
 * The parental PIN, asked for by whatever is waiting on `profiles.asking` — one
 * pad for the whole app. Vuetify's OTP field takes it from a keyboard, and from
 * a phone's number pad, which `pattern="numeric"` is what brings up.
 *
 * A television has neither, so there the digits are buttons a d-pad walks, and
 * the field is parked behind `TvField` so that passing it doesn't throw the
 * on-screen keyboard over the dialog. A remote's own number keys type wherever
 * focus is. Four digits and it answers by itself, so there is no OK to walk to.
 */
const profiles = useProfilesStore()
const tv = isTv() === true

const digits = ref('')
/** Choosing a PIN: the first entry, waiting for the second to match it. */
const first = ref('')
const error = ref('')

// Typing again is the answer to whatever went wrong.
watch(digits, value => value && (error.value = ''))

/**
 * Opened by a store write, so there is no activator for Vuetify to hand focus
 * back to — a remote's next press would start again from the top of the page.
 * So it gives focus back to whatever asked, if that is still there (a Play the
 * PIN was refused for is; a page that was left isn't).
 */
const pad = useTemplateRef<HTMLElement>('pad')
let opener: HTMLElement | null = null

watch(() => profiles.asking, (asking, was) => {
  digits.value = ''
  first.value = ''
  error.value = ''
  // Not overwritten with nothing: when a second ask follows the first at once
  // (changing the PIN asks for the old one, then a new one), the first pad has
  // unmounted and focus is on the body — the opener is still the first one's.
  const el = document.activeElement
  if (asking && !was && el instanceof HTMLElement && el !== document.body)
    opener = el
})

function refocus() {
  if (opener?.isConnected)
    opener.focus({ preventScroll: true })
  opener = null
}

const title = computed(() => profiles.asking?.choose && first.value ? $t('Enter it again') : profiles.asking?.title)

async function submit(entered: string) {
  if (profiles.asking?.choose) {
    if (!first.value) {
      first.value = entered
      digits.value = ''
      return
    }
    if (entered !== first.value) {
      first.value = ''
      digits.value = ''
      error.value = $t('Those didn\'t match. Choose it again.')
      return
    }
    await profiles.setPin(entered)
    return profiles.settle(true)
  }
  if (await profiles.verify(entered))
    return profiles.settle(true)
  digits.value = ''
  error.value = Date.now() < profiles.lockedUntil
    ? $t('Too many tries. Wait a minute and try again.')
    : $t('That isn\'t the PIN.')
}

function press(digit: string) {
  if (digits.value.length < 4)
    digits.value += digit
}

// A remote's number keys, and a keyboard's once focus has left the field — the
// field types its own.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!profiles.asking || e.target instanceof HTMLInputElement)
    return
  if (/^\d$/.test(e.key)) {
    e.preventDefault()
    press(e.key)
  }
  else if (e.key === 'Backspace') {
    e.preventDefault()
    digits.value = digits.value.slice(0, -1)
  }
})

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']
</script>

<template>
  <v-dialog
    :model-value="!!profiles.asking"
    max-width="380"
    @update:model-value="profiles.settle(false)"
    @after-enter="tv && pad?.querySelector('button')?.focus()"
    @after-leave="refocus"
  >
    <v-card v-if="profiles.asking" rounded="xl" class="pa-2">
      <v-card-title class="text-wrap text-center">
        {{ title }}
      </v-card-title>
      <v-card-text class="flex flex-col items-center gap-3">
        <p v-if="profiles.asking.text && !first" class="text-center text-body-medium opacity-75">
          {{ profiles.asking.text }}
        </p>

        <tv-field :label="$t('PIN')" class="w-60">
          <v-otp-input
            v-model="digits"
            length="4"
            pattern="numeric"
            masked
            :autofocus="!tv"
            :error="!!error"
            @finish="submit"
          />
        </tv-field>

        <p class="min-h-5 text-center text-body-medium text-error" aria-live="polite">
          {{ error }}
        </p>

        <div v-if="tv" ref="pad" class="grid w-full grid-cols-3 gap-2">
          <template v-for="key in KEYS" :key="key">
            <span v-if="!key" />
            <v-btn v-else-if="key === 'back'" variant="tonal" size="x-large" block :aria-label="$t('Delete a digit')" @click="digits = digits.slice(0, -1)">
              <v-icon :icon="mdiBackspaceOutline" />
            </v-btn>
            <v-btn v-else variant="tonal" size="x-large" block class="text-headline-small" @click="press(key)">
              {{ key }}
            </v-btn>
          </template>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="profiles.settle(false)">
          {{ $t('Cancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
