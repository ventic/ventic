<script setup lang="ts">
import { mdiCalendarBlankOutline } from '@mdi/js'

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
  <div class="h-full overflow-y-auto px-4 pb-12 md:px-6">
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

    <v-empty-state
      v-if="!calendar.followed.length"
      :icon="mdiCalendarBlankOutline"
      :headline="$t('Nothing to follow yet')"
      :text="$t('Shows in your favourites and your watchlist, and any you have been watching lately, are listed here with their new and upcoming episodes.')"
    />

    <div v-else-if="waiting" class="grid gap-x-4 gap-y-5" :style="{ gridTemplateColumns: ui.gridColumns }">
      <div v-for="n in 12" :key="n" class="animate-pulse aspect-2/3 rounded-xl bg-surface-container/60" />
    </div>

    <v-empty-state
      v-else-if="!sections.length"
      :icon="mdiCalendarBlankOutline"
      :headline="$t('Nothing new, and nothing announced')"
      :text="$t('None of the shows you follow has an episode out this week or a date for the next one.')"
    />

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
