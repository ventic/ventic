<script setup lang="ts">
import { mdiMagnify } from '@mdi/js'

/**
 * A text field a d-pad can walk *past*.
 *
 * A remote crosses the app bar's search box on its way to Downloads and
 * Settings, and a focused text field puts Android's on-screen keyboard over the
 * whole screen — every single time, for a field nobody meant to use. So on a
 * television the field is inert and a button covers it: the d-pad lands on the
 * button, and OK turns it into a field and brings the keyboard with it. That is
 * the same select-then-open the app already asks of a dropdown.
 *
 * A button rather than a `readonly` field, which parks just as well but never
 * hears about it: the WebView drops OK outright for an input it thinks can't be
 * edited — the same reason `window.__tvOk` exists for Vuetify's selects — while
 * a button is exactly what it does turn the key into a click on.
 */
defineProps<{
  placeholder: string
  density?: 'default' | 'compact'
}>()

const emit = defineEmits<{ enter: [] }>()

const query = defineModel<string>({ required: true })

const typing = ref(isTv() !== true)
const box = useTemplateRef('box')

/** OK on the parked box: become a real field, and bring the keyboard up with it. */
function edit() {
  typing.value = true
  // Android raises the keyboard only for a focus that follows a real press, so
  // this has to stay within the click that asked for it — a `nextTick` is, a
  // press on the field a moment later is not.
  nextTick(() => box.value?.querySelector('input')?.focus())
}
</script>

<template>
  <div ref="box" class="relative min-w-0">
    <!-- `inert` rather than a tabindex on the field: it takes the clear button
         out of the d-pad's way along with the input, and there is nothing here
         for a remote to do until the button below has been pressed. -->
    <div :inert="!typing">
      <v-text-field
        :model-value="query"
        :prepend-inner-icon="mdiMagnify"
        :placeholder="placeholder"
        :density="density ?? 'compact'"
        variant="solo-filled"
        rounded="lg"
        flat
        hide-details
        clearable
        @keydown.enter="emit('enter')"
        @blur="typing = isTv() !== true"
        @update:model-value="query = $event ?? ''"
      />
    </div>

    <!-- Transparent and exactly over the field, so the box a remote sees is
         the box everyone else sees (see `typing`) — and so the focus ring is
         drawn round the whole field rather than round the input inside it.
         `bg-transparent border-0` is not decoration: nothing here resets a
         bare <button>, so without them Android paints its own grey ButtonFace
         over the entire search box, which is all a television ever showed. -->
    <button
      v-if="!typing"
      class="absolute inset-0 border-0 rounded-lg bg-transparent"
      :aria-label="placeholder"
      @click="edit"
    />
  </div>
</template>
