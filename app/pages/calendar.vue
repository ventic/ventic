<script setup lang="ts">
import { mdiCalendarBlankOutline, mdiTelevisionClassic } from '@mdi/js'

/**
 * What is out, and what is coming, for every show this profile follows — its
 * favourites, its watchlist, and anything it has watched lately (see
 * `followedShows`). Each card is an episode and opens that episode's page.
 */
const calendar = useCalendarStore()
const settings = useSettingsStore()
const ui = useUiStore()
const desktop = isDesktop()

onMounted(() => calendar.refresh())

const sections = computed(() => [
  { key: 'fresh', title: $t('New episodes'), items: calendar.rows.fresh },
  { key: 'today', title: $t('Today'), items: calendar.rows.today },
  { key: 'tomorrow', title: $t('Tomorrow'), items: calendar.rows.tomorrow },
  { key: 'week', title: $t('This week'), items: calendar.rows.week },
  { key: 'later', title: $t('Later'), items: calendar.rows.later },
].filter(s => s.items.length))

/** Still fetching the first answers, which is a skeleton rather than "nothing coming". */
const waiting = computed(() => calendar.loading && !sections.value.length)
</script>

<template>
  <div class="h-full flex flex-col overflow-y-auto px-4 pb-12 md:px-6">
    <!-- A column, so an empty state takes what the heading leaves rather than
         a whole screen of its own under it: Vuetify's is `min-height: 100%`,
         and 100% plus a heading was a scrollbar on a page with nothing on it. -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 pt-1">
      <h1 class="text-title-large">
        {{ $t('Calendar') }}
      </h1>
      <v-spacer />
      <!-- The desktop's alone: on Android the app is frozen whenever it isn't
           on screen, so there is nobody awake to send the notice. -->
      <v-switch
        v-if="desktop"
        v-model="settings.airNotify"
        color="primary"
        density="comfortable"
        hide-details
        class="grow-0"
        :label="$t('Notify me on the day an episode comes out')"
      />
    </div>

    <!-- Live TV's empty state, not Vuetify's: a display-size headline is a
         poster, and this is a page saying it has nothing yet. -->
    <div v-if="!calendar.followed.length" class="grid flex-1 place-items-center">
      <div class="max-w-md flex flex-col items-center gap-3 text-center">
        <v-icon :icon="mdiCalendarBlankOutline" size="48" class="opacity-30" />
        <h2 class="text-title-large">
          {{ $t('Nothing to follow yet') }}
        </h2>
        <p class="text-body-medium opacity-70">
          {{ $t('Shows in your favourites and your watchlist, and any you have been watching lately, are listed here with their new and upcoming episodes.') }}
        </p>
        <v-btn variant="tonal" :prepend-icon="mdiTelevisionClassic" :to="localePath('/tv')">
          {{ $t('Browse TV shows') }}
        </v-btn>
      </div>
    </div>

    <div v-else-if="waiting" class="grid gap-x-4 gap-y-5" :style="{ gridTemplateColumns: ui.gridColumns }">
      <div v-for="n in 12" :key="n" class="animate-pulse aspect-2/3 rounded-xl bg-surface-container/60" />
    </div>

    <div v-else-if="!sections.length" class="grid flex-1 place-items-center">
      <div class="max-w-md flex flex-col items-center gap-3 text-center">
        <v-icon :icon="mdiCalendarBlankOutline" size="48" class="opacity-30" />
        <h2 class="text-title-large">
          {{ $t('Nothing new, and nothing announced') }}
        </h2>
        <p class="text-body-medium opacity-70">
          {{ $t('None of the shows you follow has an episode out this week or a date for the next one.') }}
        </p>
      </div>
    </div>

    <section v-for="section in sections" :key="section.key" class="pb-6">
      <h2 class="pb-3 text-title-medium">
        {{ section.title }}
      </h2>
      <div class="grid gap-x-4 gap-y-5" :style="{ gridTemplateColumns: ui.gridColumns }">
        <airing-card v-for="a in section.items" :key="`${a.show}-${a.season}-${a.episode}`" :airing="a" />
      </div>
    </section>
  </div>
</template>
