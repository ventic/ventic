<script setup lang="ts">
import { mdiRestore } from '@mdi/js'

const settings = useSettingsStore()
const ui = useUiStore()
</script>

<template>
  <div class="flex flex-col gap-6">
    <settings-section title="Size" hint="How big the interface and the posters on the browse pages are.">
      <settings-row label="App scale">
        <v-slider
          v-model="settings.uiScale"
          :min="0.8"
          :max="2"
          :step="0.05"
          thumb-label
        >
          <template #thumb-label="{ modelValue }">
            {{ Math.round(Number(modelValue) * 100) }}%
          </template>
        </v-slider>
      </settings-row>
      <settings-row label="Poster size">
        <v-slider
          v-model="ui.cardWidth"
          :min="110"
          :max="300"
          :step="10"
          thumb-label
        />
      </settings-row>
    </settings-section>

    <settings-section
      title="Performance"
      hint="Worth turning on wherever the app feels heavy — a television or a set-top box most of all,
        where the graphics chip is a fraction of a laptop's."
    >
      <v-switch
        v-model="settings.reduceEffects"
        color="primary"
        density="comfortable"
        hide-details
        label="Improve performance"
      />
      <p class="text-body-medium opacity-70">
        Turns off the effects that cost the most to draw: the frosted blur behind the sidebar and
        menus, the blur on the background art, and the fades and slides that play as things appear
        or take focus. Everything stays where it was and nothing is hidden — it stops moving and
        goes crisp instead. Loading spinners keep turning.
      </p>
      <p class="text-body-medium opacity-70">
        It tells most while moving around with a remote, which is where the fades stack up: on the
        television this was measured on, that went from 3 frames a second to 23. It starts on
        there, and off everywhere else.
      </p>
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
