<script setup lang="ts">
import type { Leveller } from '~/utils/audio'
import { mdiAccountVoice, mdiVolumeHigh } from '@mdi/js'

const settings = useSettingsStore()

/** What the chosen step actually does to a film, in the words of the complaint. */
const LEVEL_HINT: Record<Leveller, () => string> = {
  off: () => $t('The film is played as it was mixed.'),
  light: () => $t('Evens out scenes that are mixed louder or quieter than the rest, and leaves everything inside a scene alone.'),
  medium: () => $t('Holds the whole film near one volume. A whispered line and the explosion after it end up much closer together.'),
  strong: () => $t('Late-night listening: almost nothing is loud any more. Music and a quiet room can be heard breathing at this setting.'),
}

const levelHint = computed(() => LEVEL_HINT[settings.audio.normalize]())
const boost = computed(() => settings.audio.dialogue ? `+${settings.audio.dialogue} dB` : $t('Off'))
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Evening out the volume')"
      :hint="$t('Rides the volume for you, so the quiet lines come up and the loud scenes stop making you reach for the remote. This is what every film starts with — the player\'s own Audio panel changes the film you are watching and nothing else.')"
    >
      <settings-segment v-model="settings.audio.normalize" :options="LEVELLERS" />
      <p class="text-body-medium opacity-70">
        <v-icon :icon="mdiVolumeHigh" size="18" /> {{ levelHint }}
      </p>
    </settings-section>

    <settings-section
      :title="$t('Dialogue')"
      :hint="$t('Lifts the speech out of the effects. On a 5.1 or 7.1 release this raises the centre channel, which is the channel the dialogue is on and nothing else is — the music and the effects around it are untouched.')"
    >
      <div>
        <div class="text-label-medium flex items-center gap-2 opacity-70">
          <v-icon :icon="mdiAccountVoice" size="18" /> {{ $t('Boost') }} · {{ boost }}
        </div>
        <v-slider v-model="settings.audio.dialogue" :min="0" :max="MAX_DIALOGUE" :step="1" thumb-label />
      </div>
      <p class="text-body-medium opacity-70">
        {{ $t('A stereo release has no separate dialogue channel, so there the speech frequencies are lifted instead — which helps, but it lifts whatever else is up there with them.') }}
      </p>
    </settings-section>

    <settings-section :title="$t('What this works on')">
      <p class="text-body-medium opacity-70">
        {{ $t('Both settings apply to every release, whatever it was encoded with: Dolby, DTS and everything else is decoded before either of these sees it. Changes reach a film that is already playing straight away.') }}
      </p>
      <p class="text-body-medium opacity-70">
        {{ $t('The exception is Dolby or DTS handed straight to a receiver over HDMI, which Android does where it can — nothing in the app touches that sound, so neither setting has any effect on it. An amplifier doing that has a night mode of its own.') }}
      </p>
    </settings-section>
  </div>
</template>
