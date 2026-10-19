<script setup lang="ts">
import type { Airing } from '~/utils/calendar'

/**
 * One episode on the calendar, as a poster card: the show's poster, which
 * episode, and when. The same shape and the same d-pad walk as every other card
 * in the app, so a row of these on Home is a row like the rest of it.
 */
const props = defineProps<{ airing: Airing }>()

const ui = useUiStore()
const calendar = useCalendarStore()

/** "tomorrow", "in 3 days", "2 days ago" — and a date once that stops being easier to read. */
const when = computed(() => {
  const days = daysBetween(calendar.today, props.airing.air)
  return Math.abs(days) <= 7
    ? new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto' }).format(days, 'day')
    : dateText(props.airing.air)
})

const label = computed(() => [`S${props.airing.season} E${props.airing.episode}`, props.airing.name].filter(Boolean).join(' · '))
</script>

<template>
  <nuxt-link
    v-tooltip:top="label"
    :to="episodeLink(airing.show, airing.season, airing.episode)"
    class="group block select-none outline-none"
  >
    <div class="relative aspect-2/3 overflow-hidden rounded-xl bg-surface-container">
      <media-poster
        :src="posterUrl(airing.poster, ui.posterSize)"
        :alt="airing.showName"
        class="transition-transform duration-500 group-hover:scale-105 [content-visibility:auto]"
        :style="{ containIntrinsicSize: `${ui.cardWidth}px ${Math.round(ui.cardWidth * 1.5)}px` }"
      />
      <div class="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-label-small text-white tabular-nums">
        S{{ airing.season }} E{{ airing.episode }}
      </div>
      <div class="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-inset ring-primary transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
    <div class="pt-2">
      <div class="truncate text-title-small">
        {{ airing.showName }}
      </div>
      <div class="truncate text-body-small opacity-55">
        {{ when }}
      </div>
    </div>
  </nuxt-link>
</template>
