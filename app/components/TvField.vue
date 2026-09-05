<script setup lang="ts">
/**
 * A text field a d-pad can walk *past*.
 *
 * On a television a field that merely *has* focus puts Android's on-screen
 * keyboard over the whole screen — every time a remote crosses one on its way to
 * something else, which on a settings page is most of the presses. So the field
 * is `inert` and a transparent button covers it: the d-pad lands on the button,
 * OK turns it into a field and brings the keyboard up with it, and that is the
 * same select-then-open the app already asks of a dropdown. Off a television
 * none of this happens — `typing` starts true and the button is never drawn.
 *
 * A button rather than a `readonly` field, which parks just as well but never
 * hears about it: the WebView drops OK outright for an input it thinks can't be
 * edited — the same reason `window.__tvOk` exists for Vuetify's selects — while
 * a button is exactly what it does turn the key into a click on.
 */
defineProps<{
  /** What the covering button announces — the field's own label or placeholder. */
  label: string
}>()

const typing = ref(isTv() !== true)
const box = useTemplateRef('box')

/** OK on the parked box: become a real field, and bring the keyboard with it. */
function edit() {
  typing.value = true
  // Android raises the keyboard only for a focus that follows a real press, so
  // this has to stay within the click that asked for it — a `nextTick` is, a
  // press on the field a moment later is not.
  nextTick(() => box.value?.querySelector('input')?.focus())
}

/**
 * Park it again on the way out. Not while focus is still inside: a clear button,
 * a password's reveal toggle and the field itself pass focus between them, and
 * `blur` alone would close the keyboard mid-word.
 *
 * And not for focus going *nowhere*. Opening the field removes the button the
 * press landed on, which drops focus to the body and fires this with no
 * `relatedTarget` at all — read as "left the field", that parked it again a tick
 * before `edit` could focus the input, so OK on a field appeared to do nothing
 * whatever. Somewhere else is a `relatedTarget`; nowhere is this component
 * taking its own cover away.
 */
function leave(e: FocusEvent) {
  const to = e.relatedTarget as Node | null
  if (isTv() === true && to && !box.value?.contains(to))
    typing.value = false
}
</script>

<template>
  <div ref="box" class="relative min-w-0" @focusout="leave">
    <!-- `inert` rather than a tabindex on the field: it takes the clear button
         out of the d-pad's way along with the input, and there is nothing here
         for a remote to do until the button below has been pressed. -->
    <div :inert="!typing">
      <slot />
    </div>

    <!-- Transparent and exactly over the field, so the box a remote sees is the
         box everyone else sees — and so the focus ring is drawn round the whole
         field rather than round the input inside it. `bg-transparent border-0`
         is not decoration: nothing here resets a bare <button>, so without them
         Android paints its own grey ButtonFace over the entire field, which is
         all a television ever showed. -->
    <button
      v-if="!typing"
      class="absolute inset-0 border-0 rounded-lg bg-transparent"
      :aria-label="label"
      @click="edit"
    />
  </div>
</template>
