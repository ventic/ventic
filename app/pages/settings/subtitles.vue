<script setup lang="ts">
import { mdiFormatSize, mdiRestore } from '@mdi/js'

const settings = useSettingsStore()

const COLOURS = ['#ffffff', '#f2e14c', '#9fd8ff', '#ffb787', '#c0c0c0']

/** Preview frame height. mpv sizes subtitles against a 720-tall window. */
const FRAME = 224

/**
 * The style as the browser can draw it. It is a scale model, not mpv: the same
 * ratios at a quarter of the size, which is what makes "is 60 too big" a
 * question this box can answer.
 */
const cue = computed(() => {
  const s = settings.subs
  const scale = FRAME / 720
  const stroke = s.outline * scale
  return {
    fontFamily: s.font,
    fontSize: `${s.size * scale}px`,
    fontWeight: s.bold ? 700 : 400,
    color: s.color,
    // Centre-drawn stroke behind the glyph, which is how mpv draws its border.
    WebkitTextStroke: stroke > 0 ? `${stroke}px #000` : undefined,
    paintOrder: 'stroke fill',
    backgroundColor: s.background > 0 ? `rgb(0 0 0 / ${s.background})` : 'transparent',
    // sub-pos is measured from the top of the frame, 100 being the bottom, and
    // mpv keeps a margin (sub-margin-y, 34 of 720) below it.
    top: `${s.position}%`,
    transform: `translate(-50%, calc(-100% - ${34 * scale}px))`,
  }
})

/** Two lines, like the subtitles it stands in for. */
const SAMPLE = computed(() => $t('It was the fall that killed him.\nNot the drop — the sudden stop.'))
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Preview')"
      :hint="$t('Roughly what a 720p frame looks like. Changes reach a running player straight away.')"
    >
      <div
        class="relative overflow-hidden rounded-xl bg-gradient-to-br from-#2a3340 via-#141a22 to-#0b0e13"
        :style="{ height: `${FRAME}px` }"
      >
        <span class="absolute left-1/2 max-w-9/10 whitespace-pre-line rounded px-1 text-center leading-tight" :style="cue">{{ SAMPLE }}</span>
      </div>
    </settings-section>

    <settings-section :title="$t('Text')">
      <v-select v-model="settings.subs.font" :items="SUBTITLE_FONTS" :label="$t('Font')" />

      <div>
        <div class="text-label-medium opacity-70">
          {{ $t('Size') }}
        </div>
        <v-slider
          v-model="settings.subs.size"
          :prepend-icon="mdiFormatSize"
          :min="16"
          :max="90"
          :step="1"
          thumb-label
        />
      </div>

      <v-switch v-model="settings.subs.bold" :label="$t('Bold')" color="primary" hide-details density="compact" />

      <div class="text-label-medium pt-1 opacity-70">
        {{ $t('Colour') }}
      </div>
      <settings-swatches v-model="settings.subs.color" :colours="COLOURS" />
    </settings-section>

    <settings-section
      :title="$t('Legibility')"
      :hint="$t('An outline keeps white text on a white shot readable; a background box does it more bluntly.')"
    >
      <div>
        <div class="text-label-medium opacity-70">
          {{ $t('Outline') }}
        </div>
        <v-slider v-model="settings.subs.outline" :min="0" :max="5" :step="0.05" thumb-label />
      </div>

      <div>
        <div class="text-label-medium opacity-70">
          {{ $t('Background') }}
        </div>
        <v-slider v-model="settings.subs.background" :min="0" :max="1" :step="0.05" thumb-label />
      </div>

      <div>
        <div class="text-label-medium opacity-70">
          {{ $t('Vertical position') }}
        </div>
        <v-slider v-model="settings.subs.position" :min="50" :max="120" :step="1" thumb-label />
      </div>
    </settings-section>

    <div>
      <v-btn :prepend-icon="mdiRestore" variant="tonal" @click="settings.resetSubs()">
        {{ $t('Reset to mpv defaults') }}
      </v-btn>
    </div>
  </div>
</template>
