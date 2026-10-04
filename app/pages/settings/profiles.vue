<script setup lang="ts">
import type { Profile } from '~/utils/profiles'
import { mdiAccountPlusOutline, mdiDeleteOutline, mdiLockOutline, mdiPencilOutline } from '@mdi/js'

/**
 * Everyone on this install, and the parental controls on a child's profile.
 * The rules are utils/profiles'; this page edits the registry. Anything that
 * touches parental controls takes the PIN — or, the first time, chooses one.
 */
const profiles = useProfilesStore()

/** Minutes a day, as a remote steps through them; 0 is no limit. */
const LIMITS = [0, 15, 30, 45, 60, 90, 120, 180, 240]

/** A copy of the profile being edited, so Cancel leaves the real one alone. An empty id is a new one. */
const editing = ref<Profile | null>(null)
const isNew = computed(() => editing.value?.id === '')
/** The default owns the bare keys, and the one in use can't be pulled out from under itself. */
const deletable = computed(() => !!editing.value?.id && editing.value.id !== DEFAULT_PROFILE && editing.value.id !== profiles.current.id)
/** Delete is two presses: a slip on a remote shouldn't take somebody's history with it. */
const confirming = ref(false)

/** What an empty name is saved as — and so what the field and the avatar show meanwhile. */
const fallbackName = computed(() => editing.value?.id === DEFAULT_PROFILE
  ? ''
  : $t('Profile {n}', { n: profiles.list.length + (isNew.value ? 1 : 0) }))

// Opened from a row rather than an activator, so Vuetify has nothing to give
// focus back to — the row is, or a remote starts again from the top.
let opener: HTMLElement | null = null

function open(p: Profile) {
  editing.value = JSON.parse(JSON.stringify(p))
  confirming.value = false
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function refocus() {
  if (opener?.isConnected)
    opener.focus({ preventScroll: true })
  opener = null
}

function add() {
  open({ id: '', name: '', colour: COLOURS[profiles.list.length % COLOURS.length]!, at: 0 })
}

const kids = computed({
  get: () => !!editing.value?.kids,
  set: (on: boolean) => {
    editing.value!.kids = on ? { level: 'kids', minutes: 0 } : undefined
  },
})

function summary(p: Profile) {
  if (!p.kids)
    return p.nsfw ? $t('Shows NSFW anime') : ''
  const level = levelOf(p.kids).title()
  return p.kids.minutes ? $t('{level} · {time} a day', { level, time: runtimeText(p.kids.minutes) }) : level
}

/** Parental controls are a grown-up's to set: changing any, or anything about a profile that has them. */
async function asGrownUp(before?: Profile) {
  if (!before?.kids && !editing.value?.kids)
    return true
  return profiles.pinSet
    ? profiles.askPin($t('Enter the parental PIN'), $t('To change parental controls.'))
    : profiles.choosePin()
}

async function save() {
  const p = editing.value!
  if (!(await asGrownUp(profiles.list.find(x => x.id === p.id))))
    return
  const name = p.name.trim() || fallbackName.value
  const { id, at, ...fields } = { ...p, name, nsfw: !p.kids && p.nsfw ? true : undefined }
  if (isNew.value)
    profiles.create(fields)
  else
    profiles.save({ ...fields, id, at })
  editing.value = null
}

async function remove() {
  if (!confirming.value) {
    confirming.value = true
    return
  }
  const p = editing.value!
  if (!(await asGrownUp(p)))
    return
  profiles.remove(p)
  editing.value = null
}

async function changePin() {
  if (profiles.pinSet && !(await profiles.askPin($t('Enter the parental PIN'), $t('The one you have now, first.'))))
    return
  profiles.choosePin()
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Everyone on this device')"
      :hint="$t('Everyone gets their own watch history, lists and settings — theme, language, subtitles and audio. Sources, downloads and the network belong to the device, and are shared.')"
      :keywords="$t('users, accounts, family, switch user, who is watching, add profile, NSFW, adult anime')"
    >
      <v-list bg-color="transparent" class="rounded-lg bg-surface-container/40">
        <v-list-item v-for="p in profiles.list" :key="p.id" :title="profileName(p)" :subtitle="summary(p)" @click="open(p)">
          <template #prepend>
            <profile-avatar :profile="p" :size="40" class="me-4" />
          </template>
          <template #append>
            <v-chip v-if="p.id === profiles.current.id" size="small" :text="$t('In use')" />
            <v-icon :icon="mdiPencilOutline" size="20" class="ms-3 opacity-60" />
          </template>
        </v-list-item>
      </v-list>
      <v-btn :prepend-icon="mdiAccountPlusOutline" variant="tonal" class="self-start" @click="add">
        {{ $t('Add a profile') }}
      </v-btn>
    </settings-section>

    <settings-section
      :title="$t('Parental controls')"
      :hint="$t('Turned on for a profile, it shows and plays only titles up to that profile\'s age rating, can stop after a daily amount of watching, and keeps Live TV, Downloads and Settings out of reach. Leaving it, or opening a grown-up\'s profile, takes the parental PIN.')"
      :keywords="$t('PIN, kids, children, child lock, age rating, maturity rating, screen time, time limit, family')"
    >
      <v-btn :prepend-icon="mdiLockOutline" variant="tonal" class="self-start" @click="changePin">
        {{ profiles.pinSet ? $t('Change the PIN') : $t('Choose a PIN') }}
      </v-btn>
    </settings-section>

    <v-dialog :model-value="!!editing" max-width="520" scrollable @update:model-value="editing = null" @after-leave="refocus">
      <v-card v-if="editing" rounded="xl" :title="isNew ? $t('Add a profile') : $t('Edit profile')">
        <v-card-text class="flex flex-col gap-5">
          <div class="flex items-center gap-4">
            <profile-avatar :profile="{ ...editing, name: editing.name.trim() || fallbackName }" :size="56" />
            <tv-field :label="$t('Name')" class="flex-1">
              <v-text-field
                v-model="editing.name"
                :label="$t('Name')"
                :placeholder="fallbackName || $t('Default')"
                persistent-placeholder
                variant="outlined"
                density="comfortable"
                hide-details
                maxlength="24"
              />
            </tv-field>
          </div>

          <settings-swatches v-model="editing.colour" :colours="COLOURS" />

          <div>
            <v-switch v-model="kids" color="primary" density="comfortable" hide-details :label="$t('Parental controls')" />
            <p class="text-body-small opacity-70">
              {{ $t('For a child: titles up to an age rating, an optional daily limit, and the PIN to leave.') }}
            </p>
          </div>

          <template v-if="editing.kids">
            <div class="flex flex-col gap-2">
              <div class="text-title-small">
                {{ $t('Can watch') }}
              </div>
              <settings-segment v-model="editing.kids.level" :options="LEVELS" />
              <p class="text-body-small opacity-70">
                {{ $t('Films up to {movie}, shows up to {tv}. Anything unrated takes the PIN.', { movie: levelOf(editing.kids).movie, tv: levelOf(editing.kids).tv }) }}
              </p>
            </div>
            <settings-row :label="$t('Each day')">
              <settings-stepper v-model="editing.kids.minutes" :values="LIMITS" :format="m => m ? runtimeText(m) : $t('No limit')" />
            </settings-row>
          </template>

          <div v-else>
            <v-switch v-model="editing.nsfw" color="primary" density="comfortable" hide-details :label="$t('Show NSFW anime')" />
            <p class="text-body-small opacity-70">
              {{ $t('Erotic anime that TMDB doesn\'t mark as adult, in the Anime and TV Shows lists. Search finds it either way.') }}
            </p>
          </div>

          <v-alert v-if="confirming" type="warning" variant="tonal" density="compact" :text="$t('Its watch history, lists and settings go with it, on every screen that syncs.')" />
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="deletable" color="error" variant="text" :prepend-icon="mdiDeleteOutline" @click="remove">
            {{ confirming ? $t('Delete for good') : $t('Delete') }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="editing = null">
            {{ $t('Cancel') }}
          </v-btn>
          <v-btn variant="tonal" color="primary" @click="save">
            {{ $t('Save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
