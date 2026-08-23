<script setup lang="ts">
import { mdiImageOutline } from '@mdi/js'
import { BACKDROP_MODES } from '~/stores/ui'

const ui = useUiStore()

/**
 * The picture goes into localStorage, so it is re-encoded on the way in: a
 * phone photo is several megabytes before base64 adds a third, against a budget
 * of about five for every `ventic.` key put together. 1920 wide is far more
 * than a backdrop under 28px of blur can show.
 */
const picker = ref<HTMLInputElement | null>(null)
const tooBig = ref(false)

async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return

  const image = new Image()
  image.src = URL.createObjectURL(file)
  try {
    await image.decode()
    const scale = Math.min(1, 1920 / image.naturalWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    ui.backdropImage = canvas.toDataURL('image/jpeg', 0.82)
    ui.backdropMode = 'custom'
    tooBig.value = false
  }
  catch {
    // Either the file wasn't a picture the webview can decode, or the encoded
    // result didn't fit. Both leave whatever was set before in place.
    tooBig.value = true
  }
  finally {
    URL.revokeObjectURL(image.src)
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <settings-section
      :title="$t('What sits behind the app')"
      :hint="$t('Artwork from whatever you\'re looking at, a picture of your own, or nothing at all. A theme that comes with its own background sets this when you pick it.')"
    >
      <settings-segment v-model="ui.backdropMode" :options="BACKDROP_MODES" inline />

      <template v-if="ui.backdropMode === 'custom'">
        <!-- Hidden rather than styled: a file input is a poor d-pad target, so
             the button in front of it is the thing that takes focus. -->
        <input
          ref="picker"
          type="file"
          accept="image/*"
          class="hidden"
          @change="choose"
        >
        <div class="flex flex-wrap items-center gap-3">
          <img
            v-if="ui.backdropImage"
            :src="ui.backdropImage"
            :alt="$t('The picture currently behind the app')"
            class="h-16 w-28 rounded-lg object-cover"
          >
          <v-btn :prepend-icon="mdiImageOutline" variant="tonal" color="primary" @click="picker?.click()">
            {{ ui.backdropImage ? $t('Change picture') : $t('Choose a picture') }}
          </v-btn>
          <v-btn v-if="ui.backdropImage" variant="text" @click="ui.backdropImage = ''">
            {{ $t('Remove') }}
          </v-btn>
        </div>
        <p v-if="tooBig" class="text-body-medium text-error">
          {{ $t('That picture couldn\'t be saved. Try a smaller one, or a JPEG or PNG.') }}
        </p>
        <p v-else-if="!ui.backdropImage" class="text-body-medium opacity-70">
          {{ $t('Nothing chosen yet, so the background is a flat colour for now.') }}
        </p>
        <v-switch
          v-model="ui.artOverCustom"
          color="primary"
          density="comfortable"
          hide-details
          :label="$t('Let artwork take over on a title')"
        />
        <p class="text-body-medium opacity-70">
          {{ $t('On, your picture is what the app rests on and the artwork covers it while you\'re on a film or show. Off, the picture stays put and nothing ever covers it.') }}
        </p>
      </template>

      <template v-if="ui.backdropMode === 'art' || (ui.backdropMode === 'custom' && ui.artOverCustom)">
        <v-switch
          v-model="ui.backdropFollowsHover"
          color="primary"
          density="comfortable"
          hide-details
          :label="$t('Change as you browse')"
        />
        <p class="text-body-medium opacity-70">
          {{ $t('On, the background follows whichever card you\'re pointing at or have selected. Off, it only changes when you actually open something — steadier on a long list, where sweeping across a row otherwise repaints the whole window card by card.') }}
        </p>
      </template>
    </settings-section>

    <settings-section v-if="ui.backdropMode !== 'off'" :title="$t('Blur and tint')">
      <settings-row :label="$t('Blur')">
        <v-slider v-model="ui.blur" :min="0" :max="80" :step="2" thumb-label />
      </settings-row>
      <settings-row :label="$t('Tint')">
        <v-slider v-model="ui.tint" :min="0.2" :max="1" :step="0.02" thumb-label />
      </settings-row>
    </settings-section>
  </div>
</template>
