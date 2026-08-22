<script lang="ts" setup>
// Seek and volume control for the player. Not a v-slider: this one has to draw
// a buffered range behind the fill, show a time bubble under the cursor, and
// tell the player when a drag starts so polling stops fighting the thumb.
const props = withDefaults(defineProps<{
  modelValue: number
  max?: number
  /** Dimmer range behind the fill — how far the stream is buffered. */
  buffered?: number
  /** Bubble text for the position under the cursor. Omit for no bubble. */
  format?: (v: number) => string
  /** Frame to show above the bubble. Whoever answers `hover` decides if there is one. */
  thumb?: string | null
  /** That frame is a neighbour's, not this exact position's — so it's faded. */
  approx?: boolean
  disabled?: boolean
  /** How far one arrow-key press moves it — seconds for seek, percent for volume. */
  step?: number
}>(), { max: 100, buffered: 0 })

const emit = defineEmits<{
  /** Live, every frame of a drag. */
  'update:modelValue': [value: number]
  /** Pointer released — the value to actually commit. */
  'change': [value: number]
  /** True while dragging. */
  'scrub': [active: boolean]
  /** Where the cursor is, null once it leaves. Fires per move — debounce it. */
  'hover': [value: number | null]
}>()

const el = ref<HTMLElement | null>(null)
const hover = ref<number | null>(null)
const dragging = ref(false)

function valueAt(e: PointerEvent) {
  const r = el.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * props.max
}

function onDown(e: PointerEvent) {
  if (props.disabled)
    return
  // Capture so a fast drag that leaves the 6px rail keeps scrubbing.
  el.value!.setPointerCapture(e.pointerId)
  dragging.value = true
  emit('scrub', true)
  emit('update:modelValue', valueAt(e))
}

function onMove(e: PointerEvent) {
  if (props.disabled)
    return
  hover.value = valueAt(e)
  emit('hover', hover.value)
  if (dragging.value)
    emit('update:modelValue', hover.value)
}

function onLeave() {
  hover.value = null
  emit('hover', null)
}

function onUp(e: PointerEvent) {
  if (!dragging.value)
    return
  dragging.value = false
  emit('scrub', false)
  emit('change', valueAt(e))
}

/** Position along the rail, 0–1. */
function frac(v: number) {
  return Math.max(0, Math.min(1, v / (props.max || 1)))
}

function pct(v: number) {
  return `${frac(v) * 100}%`
}

// The rail is a d-pad target of its own: on a remote, left/right on the seek bar
// is the only way to scrub. preventDefault keeps the player's global seek keys
// and the d-pad's focus moves off the same press.
const KEYS: Record<string, (v: number) => number> = {
  ArrowLeft: v => v - (props.step ?? props.max / 100),
  ArrowRight: v => v + (props.step ?? props.max / 100),
  Home: () => 0,
  End: () => props.max,
}

function onKey(e: KeyboardEvent) {
  const next = KEYS[e.key]
  if (props.disabled || !next)
    return
  e.preventDefault()
  const value = Math.max(0, Math.min(props.max, next(props.modelValue)))
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <!-- h-4 is the touch target, well beyond the 3px rail, so grabbing it never
       misses. `group` is what lets the rail thicken and the knob appear on
       hover; dragging holds both open once the pointer has left the rail. -->
  <div
    ref="el"
    class="group relative h-4 flex items-center rounded touch-none"
    :class="disabled ? 'pointer-events-none cursor-default opacity-40' : 'cursor-pointer'"
    role="slider"
    :tabindex="disabled ? -1 : 0"
    :aria-valuenow="Math.round(modelValue)"
    :aria-valuemin="0"
    :aria-valuemax="max"
    @keydown="onKey"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <div
      class="relative w-full overflow-hidden rounded-full bg-white/22 transition-[height] duration-120 group-hover:h-[5px]"
      :class="dragging ? 'h-[5px]' : 'h-[3px]'"
    >
      <div class="absolute inset-y-0 left-0 bg-white/35" :style="{ width: pct(buffered) }" />
      <div class="absolute inset-y-0 left-0 bg-primary" :style="{ width: pct(modelValue) }" />
    </div>

    <!-- Sized to match VSlider's thumbSize in vuetify.config.ts. Its travel is
         inset by its own radius so the ends stay inside the rail — the volume
         slider's parent clips, and half a knob is what showed at 100%. -->
    <div
      class="absolute top-1/2 size-3.5 rounded-full bg-primary transition-transform duration-120 -translate-x-1/2 -translate-y-1/2 group-hover:scale-100"
      :class="dragging ? 'scale-100' : 'scale-0'"
      :style="{ left: `calc(7px + (100% - 14px) * ${frac(modelValue)})` }"
    />

    <!-- A frame is taller than the bar, so this one overhangs it and needs a
         cut of its own — and an opaque fill, because what shows through a hole
         in the native window is the page, not the picture. Half a frame is 96px:
         near either end the bubble stops following the cursor rather than hang
         off the side of the player. -->
    <div
      v-if="format && hover !== null"
      :data-cut="thumb ? '' : null"
      class="pointer-events-none absolute bottom-4 flex flex-col items-center overflow-hidden rounded -translate-x-1/2"
      :class="{ 'border border-white/15 bg-black': thumb }"
      :style="{ left: thumb ? `clamp(96px, ${pct(hover)}, calc(100% - 96px))` : pct(hover) }"
    >
      <img v-if="thumb" :src="thumb" alt="" class="block w-48 transition-opacity duration-100" :class="approx ? 'opacity-55' : 'opacity-100'">
      <span class="whitespace-nowrap bg-black/85 px-1.5 py-px text-label-small tabular-nums">{{ format(hover) }}</span>
    </div>
  </div>
</template>
