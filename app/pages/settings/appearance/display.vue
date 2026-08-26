<script setup lang="ts">
import { mdiRestore } from '@mdi/js'

const settings = useSettingsStore()
const ui = useUiStore()

const { locale } = useNuxtApp().$i18n

/**
 * The steps a browser's own zoom offers, which is what this now is on the
 * desktop (see `app.vue`). A list rather than the slider it replaced: a scale is
 * picked once and wants naming, and crossing a 0.05-step slider on a remote is
 * twenty-four presses.
 */
const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

const scales = computed(() => {
  const percent = new Intl.NumberFormat(locale.value, { style: 'percent' })
  return SCALES.map(value => ({ value, title: percent.format(value) }))
})

const scale = computed({
  // A value the old slider saved need not be on the list, so show the nearest —
  // it becomes one of these exactly as soon as it is touched.
  get: () => SCALES.reduce((a, b) => Math.abs(b - settings.uiScale) < Math.abs(a - settings.uiScale) ? b : a),
  set: (value: number) => (settings.uiScale = value),
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <settings-section :title="$t('Size')" :hint="$t('How big the interface and the posters on the browse pages are.')">
      <settings-row :label="$t('App scale')">
        <v-select v-model="scale" :items="scales" density="comfortable" hide-details />
      </settings-row>
      <settings-row :label="$t('Poster size')">
        <v-slider
          v-model="ui.cardWidth"
          :min="110"
          :max="300"
          :step="10"
          thumb-label
        />
      </settings-row>
      <settings-row :label="$t('Cast size')">
        <v-slider
          v-model="ui.castWidth"
          :min="100"
          :max="220"
          :step="10"
          thumb-label
        />
      </settings-row>
    </settings-section>

    <settings-section
      :title="$t('Performance')"
      :hint="$t('Worth turning on wherever the app feels heavy — a television or a set-top box most of all, where the graphics chip is a fraction of a laptop\'s.')"
    >
      <v-switch
        v-model="settings.reduceEffects"
        color="primary"
        density="comfortable"
        hide-details
        :label="$t('Improve performance')"
      />
      <p class="text-body-medium opacity-70">
        {{ $t('Turns off the effects that cost the most to draw: the frosted blur behind the sidebar and menus, the blur on the background art, and the fades and slides that play as things appear or take focus. Everything stays where it was and nothing is hidden — it stops moving and goes crisp instead. Loading spinners keep turning.') }}
      </p>
      <p class="text-body-medium opacity-70">
        {{ $t('It tells most while moving around with a remote, which is where the fades stack up: on the television this was measured on, that went from 3 frames a second to 23. It starts on there, and off everywhere else.') }}
      </p>
    </settings-section>

    <v-expansion-panels variant="accordion" rounded="lg">
      <v-expansion-panel :title="$t('Advanced')">
        <v-expansion-panel-text>
          <p class="text-body-small pb-3 opacity-70">
            <i18n-t keypath="CSS applied on top of the whole app, saved as you type. It is loaded outside every cascade layer, so a plain selector already beats the app's own styles — no {important} needed. Vuetify's palette is available as {variable} and friends." tag="span">
              <template #important>
                <code>!important</code>
              </template>
              <template #variable>
                <code>rgb(var(--v-theme-primary))</code>
              </template>
            </i18n-t>
          </p>
          <v-textarea
            v-model="settings.customCss"
            :label="$t('Global CSS')"
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
            {{ $t('Clear') }}
          </v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>
