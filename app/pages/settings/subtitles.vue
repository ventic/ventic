<script setup lang="ts">
import { mdiEarHearing, mdiFormatSize, mdiRestore } from '@mdi/js'

const settings = useSettingsStore()

/**
 * Languages to auto-pick from: the app's own locale list, which is TMDB's.
 * Subtitle catalogues answer in ISO 639-2 ("slv") and this list is 639-1
 * ("sl"), but nothing here compares codes — the player matches on the *name*
 * both resolve to, which is what already lets an mkv's "ger" and
 * OpenSubtitles' "deu" be the one language (see `langName`).
 *
 * A `v-select` rather than the autocomplete the UI-language picker uses on
 * desktop: it has a typeahead of its own, and a field a remote can't type into
 * is the only kind a television can drive at all (see that page for why).
 */
const { locale, locales } = useNuxtApp().$i18n

const languages = computed(() => {
  const collator = new Intl.Collator(locale.value)
  return locales.value
    .map(l => ({ value: l.code, title: langName(l.code) }))
    .sort((a, b) => collator.compare(a.title, b.title))
})

/**
 * The stored code is whatever last named the language — a track saying "eng",
 * an addon saying "slv", this list saying "en" — so the field has to find its
 * item the way everything else here compares languages: by the name the codes
 * resolve to. Bound to the raw value instead, a player-set "eng" matched no
 * item and the field showed the code itself.
 */
const language = computed({
  get: () => languages.value.find(l => langName(l.value) === langName(settings.subLang))?.value ?? '',
  set: (code: string) => (settings.subLang = code),
})

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
      :title="$t('Choosing subtitles')"
      :hint="$t('Turn subtitles on by themselves whenever a film starts, in the language you pick here.')"
    >
      <v-switch
        v-model="settings.autoSubs"
        :label="$t('Choose subtitles automatically')"
        color="primary"
        hide-details
        density="compact"
      />
      <v-select
        v-model="language"
        :items="languages"
        :label="$t('Subtitle language')"
        :disabled="!settings.autoSubs"
        variant="solo-filled"
        hide-details
        :menu-props="{ maxHeight: 480 }"
      />
      <p class="text-body-medium opacity-70">
        {{ $t('A track already inside the file is used first, then one that came with the download, and only then is OpenSubtitles searched. Picking a different language while watching changes this setting too.') }}
      </p>

      <v-switch
        v-model="settings.subs.hideCaptions"
        :label="$t('Hide sound descriptions')"
        :prepend-icon="mdiEarHearing"
        color="primary"
        hide-details
        density="compact"
      />
      <p class="text-body-medium opacity-70">
        {{ $t('Drops “(electricity buzzing)” and “MAN:” from subtitles written for the hard of hearing.') }}
      </p>
    </settings-section>

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
