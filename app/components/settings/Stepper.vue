<script setup lang="ts">
import type { Steps } from '~/utils/steps'
import { mdiMinus, mdiPlus } from '@mdi/js'

/**
 * Less, the value, more. What every slider on the settings pages became: a
 * remote walks between two buttons and presses OK, a thumb taps, and a mouse
 * clicks — one control that every input the app has can drive.
 *
 * Either a range (`min`/`max`/`step`) or a list of `values`; see utils/steps.
 */
const props = defineProps<{
  min?: number
  max?: number
  step?: number
  values?: number[]
  /** How the value reads — "44 px", "30%", "Automatic". Plain digits otherwise. */
  format?: (value: number) => string
}>()

const model = defineModel<number>({ required: true })

const steps = computed<Steps>(() => props.values
  ? { values: props.values }
  : { min: props.min ?? 0, max: props.max ?? 100, step: props.step ?? 1 })

const less = computed(() => stepTo(model.value, -1, steps.value))
const more = computed(() => stepTo(model.value, 1, steps.value))
const label = computed(() => props.format?.(model.value) ?? String(model.value))
</script>

<template>
  <div class="flex items-center gap-2">
    <v-btn icon size="small" variant="tonal" :disabled="less === model" :aria-label="$t('Less')" @click="model = less">
      <v-icon :icon="mdiMinus" size="20" />
    </v-btn>
    <!-- A fixed width, so the buttons stay put as "8" becomes "10". -->
    <span class="min-w-24 text-center text-body-medium tabular-nums" aria-live="polite">{{ label }}</span>
    <v-btn icon size="small" variant="tonal" :disabled="more === model" :aria-label="$t('More')" @click="model = more">
      <v-icon :icon="mdiPlus" size="20" />
    </v-btn>
  </div>
</template>
