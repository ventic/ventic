<script setup lang="ts">
import { mdiBlur, mdiImageSizeSelectSmall, mdiMagnifyPlusOutline, mdiOpacity, mdiRestore } from '@mdi/js'
import { ACCENTS } from '~/theme/palette'
import { THEMES, themes } from '~/theme/themes'

const settings = useSettingsStore()
const ui = useUiStore()

/** The three colours a palette is recognisable by, straight from its definition. */
function swatch(name: keyof typeof themes) {
  const c = themes[name].colors!
  return {
    background: c.background as string,
    surface: c['surface-container-high'] as string,
    primary: (settings.accent || c.primary) as string,
  }
}

// Which group a theme belongs in is read off its own definition rather than
// listed twice — a light theme filed under Dark is then impossible.
const groups = [
  { title: 'Dark', themes: THEMES.filter(t => themes[t.value].dark) },
  { title: 'Light', themes: THEMES.filter(t => !themes[t.value].dark) },
]
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      v-for="group in groups"
      :key="group.title"
      :title="`${group.title} themes`"
      :hint="group.title === 'Dark' ? 'Applies everywhere, straight away.' : undefined"
    >
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          v-for="option in group.themes"
          :key="option.value"
          type="button"
          class="flex flex-col gap-2 rounded-xl border-2 p-2 text-left text-on-surface transition-colors duration-120"
          :class="settings.theme === option.value
            ? 'border-primary bg-surface-container-high'
            : 'border-transparent bg-surface-container/50 hover:bg-surface-container-high focus-visible:bg-surface-container-high'"
          :aria-pressed="settings.theme === option.value"
          @click="settings.theme = option.value"
        >
          <span
            class="h-12 w-full flex items-center gap-1 rounded-lg px-2"
            :style="{ backgroundColor: swatch(option.value).background }"
          >
            <span class="h-6 flex-1 rounded" :style="{ backgroundColor: swatch(option.value).surface }" />
            <span class="size-6 rounded-full" :style="{ backgroundColor: swatch(option.value).primary }" />
          </span>
          <span class="text-label-large px-1">{{ option.title }}</span>
        </button>
      </div>
    </settings-section>

    <settings-section
      title="Accent colour"
      hint="Buttons, focus rings and highlights. Left alone, each theme uses its own."
    >
      <settings-swatches v-model="settings.accent" :colours="ACCENTS" clear-label="Theme default" />
    </settings-section>

    <settings-section
      title="App scale"
      hint="Zooms the entire interface."
    >
      <v-slider
        v-model="settings.uiScale"
        :prepend-icon="mdiMagnifyPlusOutline"
        :min="0.8"
        :max="2"
        :step="0.05"
        thumb-label
      >
        <template #thumb-label="{ modelValue }">
          {{ Math.round(Number(modelValue) * 100) }}%
        </template>
      </v-slider>
    </settings-section>

    <settings-section
      title="Backdrop"
      hint="The poster art behind the app: how far it's blurred, and how much colour is left showing."
    >
      <v-slider v-model="ui.blur" :prepend-icon="mdiBlur" :min="0" :max="80" :step="2" thumb-label />
      <v-slider v-model="ui.tint" :prepend-icon="mdiOpacity" :min="0.2" :max="1" :step="0.02" />
    </settings-section>

    <settings-section title="Poster size" hint="How big cards are on the browse pages.">
      <v-slider
        v-model="ui.cardWidth"
        :prepend-icon="mdiImageSizeSelectSmall"
        :min="110"
        :max="300"
        :step="10"
        thumb-label
      />
    </settings-section>

    <v-expansion-panels variant="accordion" rounded="lg">
      <v-expansion-panel title="Advanced">
        <v-expansion-panel-text>
          <p class="text-body-small pb-3 opacity-70">
            CSS applied on top of the whole app, saved as you type. It is loaded outside every
            cascade layer, so a plain selector already beats the app's own styles — no
            <code>!important</code> needed. Vuetify's palette is available as
            <code>rgb(var(--v-theme-primary))</code> and friends.
          </p>
          <v-textarea
            v-model="settings.customCss"
            label="Global CSS"
            placeholder=".v-toolbar { letter-spacing: 0.5px }"
            rows="8"
            spellcheck="false"
            class="font-mono text-body-small"
            hide-details
          />
          <v-btn
            v-if="settings.customCss"
            :prepend-icon="mdiRestore"
            variant="text"
            size="small"
            class="mt-2"
            @click="settings.customCss = ''"
          >
            Clear
          </v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>
