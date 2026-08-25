<script setup lang="ts">
import type { Supporters } from '~/utils/supporters'
import { mdiCoffee, mdiHeart, mdiOpenInNew } from '@mdi/js'

/**
 * The Ko-fi page, the goal, and the people who got it there.
 *
 * The list is fetched, not bundled — see `utils/supporters.ts` for why a hand-
 * kept JSON file is the only way an app with no server can name its donors.
 * Failing to load it is a non-event: the donate button is the point of the
 * page and doesn't depend on it.
 */
const GITHUB_URL = `https://github.com/${REPO}`

const { locale } = useNuxtApp().$i18n

const supporters = ref<Supporters | null>(null)
const loading = ref(true)

onMounted(() => fetchSupporters()
  .then(s => (supporters.value = s))
  .catch(() => {})
  .finally(() => (loading.value = false)))

const money = computed(() => new Intl.NumberFormat(locale.value, {
  style: 'currency',
  currency: supporters.value?.currency ?? 'EUR',
  maximumFractionDigits: 0,
}))

/** Capped at 100: passing the goal is good news, not a bar drawn off the end. */
const progress = computed(() => {
  const s = supporters.value
  return s?.goal ? Math.min(100, (s.raised / s.goal) * 100) : 0
})

// Same escape hatch as the About page: the shell plugin has no Android
// implementation and fails with ENOENT looking for `xdg-open`.
function open(url: string) {
  useTauriShellOpen(url).catch(() => window.open(url, '_blank'))
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <settings-section
      :title="$t('Ko-fi')"
      :hint="$t('Ventic is free, has no ads, no account and nothing to sell. It costs money to sign, host and keep running — a donation is what covers that, and nothing in the app changes whether you give one or not.')"
    >
      <v-card rounded="xl" class="panel flex flex-col gap-4 p-6">
        <template v-if="supporters?.goal">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div class="text-title-medium">
              {{ $t('{raised} of {goal}', {
                raised: money.format(supporters.raised),
                goal: money.format(supporters.goal),
              }) }}
            </div>
            <div class="text-body-medium opacity-70">
              {{ $t('{percent}% of the way there', { percent: Math.round(progress) }) }}
            </div>
          </div>
          <v-progress-linear :model-value="progress" color="primary" rounded height="10" />
        </template>

        <div>
          <v-btn :prepend-icon="mdiCoffee" variant="flat" color="primary" @click="open(KOFI_URL)">
            {{ $t('Donate on Ko-fi') }}
          </v-btn>
        </div>
        <p class="text-body-small opacity-70">
          {{ $t('One-off or monthly, from any card or PayPal. Ko-fi takes no cut of it.') }}
        </p>
      </v-card>
    </settings-section>

    <settings-section
      v-if="supporters?.monthly.length"
      :title="$t('Monthly supporters')"
      :hint="$t('Paying for this every month, which is the part that makes it predictable.')"
    >
      <!-- Text only: nothing here is a target, so the d-pad scrolls past it. -->
      <div class="flex flex-wrap gap-2">
        <div
          v-for="person in supporters.monthly"
          :key="person.name"
          class="text-body-medium flex items-center gap-2 rounded-full bg-surface-container/60 py-2 pl-3 pr-4"
        >
          <v-icon :icon="mdiHeart" size="16" color="primary" />
          <span>{{ person.name }}</span>
          <span v-if="person.at" class="text-body-small opacity-60">{{ person.at }}</span>
        </div>
      </div>
    </settings-section>

    <settings-section
      v-if="supporters?.once.length"
      :title="$t('Donations')"
      :hint="$t('Everyone who has bought a coffee so far. Thank you.')"
    >
      <div class="flex flex-wrap gap-2">
        <div
          v-for="(person, i) in supporters.once"
          :key="`${person.name}-${i}`"
          class="text-body-medium flex items-center gap-2 rounded-full bg-surface-container/60 py-2 pl-3 pr-4"
        >
          <span>{{ person.name }}</span>
          <span v-if="person.amount" class="text-body-small opacity-60">{{ money.format(person.amount) }}</span>
        </div>
      </div>
    </settings-section>

    <p v-if="loading" class="text-body-medium opacity-60">
      {{ $t('Loading…') }}
    </p>
    <p v-else-if="!supporters" class="text-body-medium opacity-60">
      {{ $t('The supporter list couldn\'t be loaded — the Ko-fi page above has the current one.') }}
    </p>

    <settings-section :title="$t('Other ways to help')">
      <p class="text-body-medium">
        {{ $t('Money is the least of it. Reporting a bug with what you did before it happened, translating the app into a language you actually speak, or telling somebody it exists are all worth more than a coffee.') }}
      </p>
      <div>
        <v-btn :append-icon="mdiOpenInNew" variant="tonal" size="small" @click="open(GITHUB_URL)">
          {{ $t('The project on GitHub') }}
        </v-btn>
      </div>
    </settings-section>
  </div>
</template>
