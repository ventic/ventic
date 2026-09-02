<script setup lang="ts">
import { mdiAccountOutline, mdiAlertCircleOutline, mdiMovieOpenOutline } from '@mdi/js'

// A static segment beats `[type]/[id]`, so /person/123 lands here rather than
// on the media page that validates movie|tv. Anything but a number 404s.
definePageMeta({
  validate: ({ params }) => 'id' in params && /^\d+$/.test(params.id),
})

/** Cards per screenful-and-a-bit — enough that the first fill never looks short. */
const PAGE = 60

const route = useRoute()
const ui = useUiStore()

const id = computed(() => String(route.params.id))

const { data: person, status, error } = usePerson(id)

// A person has no artwork of their own, so the page borrows their best-known
// title's — which is also where the palette is read from, and leaving it on
// whatever page you arrived from would colour an actor by someone else's film.
let mine = 0
watch(person, value => value?.credits[0] && (mine = ui.select(value.credits[0])), { immediate: true })
onUnmounted(() => ui.release(mine))

const facts = computed(() => {
  const p = person.value
  if (!p)
    return []
  // Age only while they are alive: "67 years old" beside a date of death is a
  // sentence about the wrong tense, and the two dates already say it.
  const age = p.deathday ? 0 : yearsSince(p.birthday)
  return [
    { label: $t('Born'), value: [dateText(p.birthday), age && $t('{age} years old', { age })].filter(Boolean).join(' · ') },
    { label: $t('Died'), value: dateText(p.deathday) },
    { label: $t('Birthplace'), value: p.birthplace },
  ].filter(row => row.value)
})

const expanded = ref(false)
const bio = ref<HTMLElement | null>(null)
/**
 * Whether the clamp is actually hiding anything — a two-line biography gets no
 * button. Measured rather than guessed from the length: six lines is a
 * paragraph on a desktop and most of a phone screen, and the same text is one
 * or the other depending on the window.
 */
const clipped = ref(false)
useResizeObserver(bio, ([entry]) => {
  const el = entry?.target
  clipped.value = !!el && (expanded.value || el.scrollHeight > el.clientHeight + 1)
})

// A prolific name has three hundred credits, and content-visibility only saves
// the *paint* of the ones off screen — mounting them is script and layout a
// television pays for before the page is usable. So the grid grows as it is
// scrolled, the way a row pages in: the first screenful is the only one anybody
// waits for.
const shown = ref(PAGE)
const scroller = ref<HTMLElement | null>(null)
watch(id, () => (shown.value = PAGE))
useInfiniteScroll(
  scroller,
  () => { shown.value += PAGE },
  { distance: 800, canLoadMore: () => shown.value < (person.value?.credits.length ?? 0) },
)
const credits = computed(() => person.value?.credits.slice(0, shown.value) ?? [])

// Deliberately not the browse pages' list/grid switch: this is a strip of work
// belonging to one person, the same way "More like this" is, and both are cards.
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${ui.cardWidth}px, 1fr))`,
}))
</script>

<template>
  <div ref="scroller" class="h-full overflow-y-auto pb-12">
    <div v-if="error" class="flex h-full flex-col items-center justify-center gap-2">
      <v-icon :icon="mdiAlertCircleOutline" color="error" size="40" />
      <span class="text-body-medium opacity-70">{{ $t('Couldn\'t load this person.') }}</span>
      <v-btn variant="tonal" :to="localePath('/')">
        {{ $t('Go home') }}
      </v-btn>
    </div>

    <template v-else>
      <section class="px-4 pb-8 pt-4 md:px-6">
        <div class="media-hero">
          <div class="media-hero-poster [&_img]:object-top">
            <media-poster :src="profileUrl(person?.profile, 'h632')" :alt="person?.name" :icon="mdiAccountOutline" />
          </div>

          <!-- The name keeps the portrait company; the facts and the biography
               go below both of them until there is room for a column. -->
          <h1 v-if="person" class="text-headline-medium min-w-0 self-center font-bold drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] sm:text-headline-large">
            {{ person.name }}
          </h1>

          <div v-if="person" class="media-hero-body">
            <dl v-if="facts.length" class="grid grid-cols-1 gap-x-6 gap-y-1 text-body-small sm:grid-cols-2 lg:max-w-2xl">
              <div v-for="row in facts" :key="row.label" class="flex gap-2">
                <dt class="w-20 shrink-0 opacity-50">
                  {{ row.label }}
                </dt>
                <dd class="truncate opacity-85">
                  {{ row.value }}
                </dd>
              </div>
            </dl>

            <!-- The two classes swap rather than stack. TMDB biographies carry
                 real paragraph breaks, which are worth having open — but a blank
                 line inside a clamp is a line, and the six the clamp allows kept
                 ending on one, leaving an ellipsis alone under the text. Folded
                 shut the newlines collapse, so all six lines are prose. -->
            <p
              v-if="person.biography"
              ref="bio"
              class="max-w-3xl text-body-medium opacity-85"
              :class="expanded ? 'whitespace-pre-line' : 'line-clamp-6'"
            >
              {{ person.biography }}
            </p>
            <v-btn v-if="clipped" variant="text" size="small" class="self-start -ml-2" @click="expanded = !expanded">
              {{ expanded ? $t('Show less') : $t('Show more') }}
            </v-btn>
          </div>

          <div v-else class="media-hero-body self-center">
            <div class="animate-pulse h-10 w-2/3 max-w-sm rounded-lg bg-surface-container/60" />
            <div class="animate-pulse h-4 w-40 rounded bg-surface-container/60" />
            <div class="animate-pulse h-20 w-full max-w-2xl rounded-lg bg-surface-container/60" />
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-3 px-4 md:px-6">
        <h2 class="text-title-large">
          {{ $t('Known for') }}
        </h2>

        <div class="grid gap-x-4 gap-y-5" :style="gridStyle">
          <media-card
            v-for="media in credits"
            :key="`${media.type}-${media.id}`"
            :media="media"
            :detail="ui.isDetailed"
          />
          <div
            v-for="n in status === 'pending' ? 12 : 0"
            :key="`skeleton-${n}`"
            class="animate-pulse aspect-2/3 rounded-xl bg-surface-container/60"
          />
        </div>

        <div v-if="status !== 'pending' && !person?.credits.length" class="flex flex-col items-center gap-2 py-8">
          <v-icon :icon="mdiMovieOpenOutline" size="40" class="opacity-30" />
          <span class="text-body-medium opacity-70">{{ $t('Nothing here.') }}</span>
        </div>
      </section>
    </template>
  </div>
</template>
