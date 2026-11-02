<script setup lang="ts">
import type { Leveller } from '~/utils/audio'
import { mdiVolumeHigh } from '@mdi/js'

const settings = useSettingsStore()

/** What the chosen step actually does to a film, in the words of the complaint. */
const LEVEL_HINT: Record<Leveller, () => string> = {
  off: () => $t('The film is played as it was mixed.'),
  light: () => $t('Evens out scenes that are mixed louder or quieter than the rest, and leaves everything inside a scene alone.'),
  medium: () => $t('Holds the whole film near one volume. A whispered line and the explosion after it end up much closer together.'),
  strong: () => $t('Late-night listening: almost nothing is loud any more. At this setting you can hear music and quiet scenes being pushed up and down.'),
}

const levelHint = computed(() => LEVEL_HINT[settings.audio.normalize]())
const boost = (value: number) => value ? `+${value} dB` : $t('Off')
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Evening out the volume')"
      :hint="$t('Rides the volume for you, so the quiet lines come up and the loud scenes stop making you reach for the remote. Every film starts with this, and the player\'s own Audio panel changes only the film you are watching.')"
      :keywords="$t('volume normalisation, normalization, normalize, loudness, dynamic range compression, DRC, night mode, too loud, too quiet')"
    >
      <settings-segment v-model="settings.audio.normalize" :options="LEVELLERS" />
      <p class="text-body-medium opacity-70">
        <v-icon :icon="mdiVolumeHigh" size="18" /> {{ levelHint }}
      </p>
    </settings-section>

    <settings-section
      :title="$t('Dialogue')"
      :hint="$t('Lifts the speech above the effects. On a 5.1 or 7.1 release this raises the centre channel, which carries only the dialogue, and leaves the music and effects around it alone.')"
      :keywords="$t('voice, speech, clear voice, centre channel, center channel, can\'t hear, mumbling, dialog enhancement')"
    >
      <settings-row :label="$t('Boost')">
        <settings-stepper v-model="settings.audio.dialogue" :min="0" :max="MAX_DIALOGUE" :step="1" :format="boost" />
      </settings-row>
      <p class="text-body-medium opacity-70">
        {{ $t('A stereo release has no separate dialogue channel, so the speech frequencies are lifted instead. That helps, but it also lifts any other sound in that range.') }}
      </p>
    </settings-section>

    <settings-section :title="$t('What this works on')" :keywords="$t('passthrough, bitstream, AV receiver, soundbar, surround sound, 5.1, 7.1, Atmos')">
      <p class="text-body-medium opacity-70">
        {{ $t('Both settings work on every release, Dolby and DTS included, because the audio is decoded before either of them sees it. Changes reach a film that is already playing straight away.') }}
      </p>
      <p class="text-body-medium opacity-70">
        {{ $t('The exception is Dolby or DTS handed straight to a receiver over HDMI, which Android does where it can. The app never touches that sound, so neither setting has any effect on it. A receiver that does this has a night mode of its own.') }}
      </p>
    </settings-section>
  </div>
</template>
