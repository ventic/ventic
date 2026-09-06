<script setup lang="ts">
import type { KeyAction } from '~/utils/keys'
import { mdiRestore } from '@mdi/js'

const settings = useSettingsStore()
const bound = computed(() => keyBindings(settings.keys))

/** The row waiting for a key, if any. */
const recording = ref<KeyAction | null>(null)

// Capture phase, so an arrow pressed for a binding isn't also a d-pad move
// (plugins/dpad.client.ts listens on document) and the space bar doesn't click
// the button that started the recording.
useEventListener(window, 'keydown', e => {
  if (!recording.value)
    return
  e.preventDefault()
  e.stopPropagation()
  const key = chord(e)
  // A modifier on its own: wait for the rest of it.
  if (!key)
    return
  if (key !== 'Escape')
    settings.keys = bindKey(settings.keys, recording.value, key === 'Backspace' || key === 'Delete' ? '' : key)
  recording.value = null
}, { capture: true })
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Shortcuts')"
      :hint="$t('While a film is playing. Choose one, then press the key you want it on — Backspace takes it away, Escape leaves it as it was.')"
    >
      <div v-for="action in KEY_ACTIONS" :key="action.value" class="flex items-center justify-between gap-4">
        <span class="text-body-medium">{{ action.title() }}</span>
        <v-btn
          variant="tonal"
          :color="recording === action.value ? 'primary' : undefined"
          class="min-w-36 shrink-0"
          @click="recording = recording === action.value ? null : action.value"
        >
          {{ recording === action.value ? $t('Press a key…') : keyLabel(bound[action.value]) || $t('Not set') }}
        </v-btn>
      </div>
      <p class="text-body-medium opacity-70">
        {{ $t('The digits 0–9 always jump to that tenth of the film.') }}
      </p>
    </settings-section>

    <div>
      <v-btn :prepend-icon="mdiRestore" variant="tonal" :disabled="!Object.keys(settings.keys).length" @click="settings.keys = {}">
        {{ $t('Reset to defaults') }}
      </v-btn>
    </div>
  </div>
</template>
