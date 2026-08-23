<script setup lang="ts">
import type { ThemeName } from '~/theme/presets'
import { mdiCheck } from '@mdi/js'
import { fromHue, hueOf, scheme } from '~/theme/palette'
import { PRESET_LIST, PRESETS } from '~/theme/presets'
import { isGenerated, themes } from '~/theme/themes'

const settings = useSettingsStore()
const ui = useUiStore()

/**
 * Twenty-eight themes is more than fits on a screen, and nobody is choosing
 * between a dark one and a light one — so the list opens on the kind that is
 * already current and the other is one press away.
 */
const filter = ref<'all' | 'dark' | 'light'>(PRESETS[settings.theme as ThemeName]?.dark === false ? 'light' : 'dark')

const FILTERS = [
  { value: 'dark', title: () => $t('Dark') },
  { value: 'light', title: () => $t('Light') },
  { value: 'all', title: () => $t('All') },
] as const

const groups = computed(() => {
  const dark = { title: $t('Dark'), items: PRESET_LIST.filter(([, p]) => p.dark) }
  const light = { title: $t('Light'), items: PRESET_LIST.filter(([, p]) => !p.dark) }
  return filter.value === 'dark' ? [dark] : filter.value === 'light' ? [light] : [dark, light]
})

/** The generated palettes, live — their tiles have to move as the slider does. */
const live = computed(() => ({
  generated: scheme(settings.source, true),
  generatedLight: scheme(settings.source, false),
}))

/** What a tile paints: the theme's own colours, and the background it brings. */
function preview(name: ThemeName) {
  const c = isGenerated(name) ? live.value[name as 'generated'] : themes[name].colors!
  return {
    background: c.background as string,
    panel: c['surface-container-high'] as string,
    text: c['on-surface'] as string,
    primary: c.primary as string,
    image: PRESETS[name].backdrop?.image,
  }
}

/**
 * Picking a theme is the one moment its preset is applied: everything it names
 * is written into the settings below as if the user had set it there, and is
 * then theirs to move. A theme that names no background leaves the picture the
 * user chose alone.
 */
function pick(name: ThemeName) {
  settings.theme = name
  const b = PRESETS[name].backdrop
  if (b?.mode)
    ui.backdropMode = b.mode
  if (b?.image)
    ui.backdropImage = b.image
  if (b?.blur !== undefined)
    ui.blur = b.blur
  if (b?.tint !== undefined)
    ui.tint = b.tint
}

const hue = computed({
  get: () => hueOf(settings.source),
  set: h => {
    settings.source = fromHue(h)
  },
})

/** The bar the hue slider runs along, and the shortcuts under it: the same colours it sets. */
const stops = Array.from({ length: 8 }, (_, i) => fromHue(i * 45))
const spectrum = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => fromHue(i * 30)).join(', ')})`
</script>

<template>
  <div class="flex flex-col gap-6">
    <settings-segment v-model="filter" :options="FILTERS" inline />

    <section v-for="group in groups" :key="group.title" class="flex flex-col gap-3">
      <h3 v-if="groups.length > 1" class="text-title-small opacity-70">
        {{ group.title }}
      </h3>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <button
          v-for="[name, theme] in group.items"
          :key="name"
          type="button"
          class="flex flex-col gap-1.5 border-none rounded-xl p-1.5 text-left text-on-surface transition-colors duration-120"
          :class="settings.theme === name
            ? 'bg-surface-container-high ring-2 ring-primary'
            : 'bg-surface-container/40 hover:bg-surface-container-high focus-visible:bg-surface-container-high'"
          :aria-pressed="settings.theme === name"
          @click="pick(name)"
        >
          <!-- A miniature of the app rather than three swatches: the surface it
               rests on, a panel, a line of text and the accent — plus whatever
               background the theme brings with it, which is half of what makes
               one recognisable. -->
          <span
            class="relative aspect-[16/10] w-full flex gap-1.5 overflow-hidden rounded-lg bg-cover bg-center p-2"
            :style="{
              backgroundColor: preview(name).background,
              backgroundImage: preview(name).image ? `url(${preview(name).image})` : undefined,
            }"
          >
            <span class="w-1.5 rounded-full" :style="{ backgroundColor: preview(name).panel }" />
            <span class="flex flex-1 flex-col justify-end gap-1.5">
              <span class="h-1.5 w-3/5 rounded-full opacity-60" :style="{ backgroundColor: preview(name).text }" />
              <span class="h-3 w-3 rounded-full" :style="{ backgroundColor: preview(name).primary }" />
            </span>
            <v-icon
              v-if="settings.theme === name"
              :icon="mdiCheck"
              size="16"
              class="absolute right-1 top-1 rounded-full bg-primary text-on-primary"
            />
          </span>
          <!-- Preset names are product names and stay as they are; the generated
               pair is a description, so it is the one title that translates. -->
          <span class="text-label-large truncate px-1">{{ theme.generated ? $t('Your colour') : theme.title }}</span>
        </button>
      </div>
    </section>

    <!-- Only with a generated palette current: the slider has nothing to move
         otherwise, and picking a theme is the way back to a fixed one. -->
    <settings-section
      v-if="isGenerated(settings.theme)"
      :title="$t('Your colour')"
      :hint="$t('One colour, and Material\'s own generator works out the rest of the palette from it.')"
    >
      <v-slider
        v-model="hue"
        class="spectrum"
        :style="{ '--spectrum': spectrum }"
        :color="settings.source"
        :min="0"
        :max="359"
        :step="1"
      />
      <settings-swatches v-model="settings.source" :colours="stops" />
    </settings-section>

    <settings-section
      :title="$t('Follow the artwork')"
      :hint="$t('Builds the palette from whatever is on screen instead, so the interface shifts as you move between titles. Your theme comes back the moment you turn it off.')"
    >
      <v-switch
        v-model="settings.themeFromArt"
        color="primary"
        density="comfortable"
        hide-details
        :label="$t('Take the colour from what\'s on screen')"
      />
      <template v-if="settings.themeFromArt && ui.backdropMode === 'custom'">
        <v-switch
          v-model="settings.colourFromPicture"
          color="primary"
          density="comfortable"
          hide-details
          :label="$t('Take it from my own picture too')"
        />
        <p class="text-body-medium opacity-70">
          {{ $t('Off, your own background is left out of it: the theme keeps its own colours while the picture is up, and only moves when a title\'s artwork covers it.') }}
        </p>
      </template>
    </settings-section>
  </div>
</template>

<style scoped>
/* The whole point of this slider is the colours it can reach, so the track is
   the spectrum itself rather than a filled bar. */
.spectrum :deep(.v-slider-track__background) {
  background: var(--spectrum);
  opacity: 1;
}

.spectrum :deep(.v-slider-track__fill) {
  display: none;
}
</style>
