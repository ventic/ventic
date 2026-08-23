<script setup lang="ts">
import { mdiPaletteSwatch } from '@mdi/js'

/**
 * A row of colour buttons plus a full picker behind one more.
 *
 * The swatches are the whole control on a TV — a colour canvas can't be driven
 * by a d-pad — so the presets have to be enough on their own.
 */
const props = defineProps<{ colours: string[] }>()

const model = defineModel<string>({ required: true })

const open = ref(false)
/** The picker fires per pixel dragged, and each value repaints something. */
const custom = ref(model.value || props.colours[0]!)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <button
      v-for="colour in colours"
      :key="colour"
      type="button"
      class="size-9 rounded-full border-2 transition-transform duration-120 hover:scale-110 focus-visible:scale-110"
      :class="model.toLowerCase() === colour.toLowerCase() ? 'border-on-surface' : 'border-outline-variant'"
      :style="{ backgroundColor: colour }"
      :aria-label="colour"
      :aria-pressed="model.toLowerCase() === colour.toLowerCase()"
      @click="model = colour"
    />

    <v-menu v-model="open" :close-on-content-click="false" location="bottom start">
      <template #activator="{ props: menu }">
        <v-btn v-bind="menu" :prepend-icon="mdiPaletteSwatch" variant="tonal" size="small">
          {{ $t('Custom') }}
        </v-btn>
      </template>
      <v-card rounded="xl" class="p-3">
        <v-color-picker v-model="custom" mode="hex" hide-inputs width="260" />
        <v-btn block class="mt-3" @click="model = custom; open = false">
          {{ $t('Use this colour') }}
        </v-btn>
      </v-card>
    </v-menu>
  </div>
</template>
