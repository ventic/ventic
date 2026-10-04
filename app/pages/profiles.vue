<script setup lang="ts">
import { mdiAccountMultipleOutline, mdiTimerSandComplete } from '@mdi/js'

/**
 * "Who's watching?" — and, for a child whose time is up, the lock screen. One
 * page, because both answer the same question: whose this screen is. Full
 * screen, with no app bar to walk out through; the route middleware sends
 * everything here until it has been answered.
 */
definePageMeta({ layout: false })

const profiles = useProfilesStore()
const route = useRoute()

/** Where the gate interrupted, so answering it carries on there. Only ever a path in the app. */
const to = computed(() => {
  const q = route.query.to
  return typeof q === 'string' && /^\/(?!\/)/.test(q) ? q : localePath('/')
})

const name = computed(() => profileName(profiles.current))

/** The lock screen's own way out: the picker, where leaving takes the PIN as ever. */
const picking = ref(false)
const locked = computed(() => profiles.timeUp && !picking.value)
// Picking the same profile again comes straight back here, to the lock.
watch(() => route.fullPath, () => (picking.value = false))

async function more(minutes: number) {
  if (await profiles.askPin($t('Ask a grown-up'), $t('To give {name} more time today.', { name: name.value }))) {
    profiles.extend(minutes)
    navigateTo(to.value, { replace: true })
  }
}
</script>

<template>
  <v-app>
    <app-background />
    <v-main class="relative z-1 h-dvh">
      <div data-dpad-start class="safe-inset h-full overflow-y-auto">
        <v-empty-state
          v-if="locked"
          :icon="mdiTimerSandComplete"
          color="primary"
          :headline="$t('That\'s all for today')"
          :text="$t('{name} has used up today\'s watch time. A grown-up can add more.', { name })"
          class="min-h-full"
        >
          <template #actions>
            <v-btn size="large" variant="flat" @click="more(30)">
              {{ $t('30 more minutes') }}
            </v-btn>
            <v-btn size="large" variant="tonal" @click="more(120)">
              {{ $t('2 more hours') }}
            </v-btn>
            <v-btn size="large" variant="text" @click="picking = true">
              {{ $t('Switch profile') }}
            </v-btn>
          </template>
        </v-empty-state>

        <v-empty-state v-else :headline="$t('Who\'s watching?')" color="primary" class="min-h-full">
          <div class="flex flex-wrap justify-center gap-2">
            <v-btn
              v-for="p in profiles.list"
              :key="p.id"
              variant="text"
              color="on-surface"
              stacked
              height="auto"
              width="168"
              class="py-4"
              :aria-current="profiles.chosen && p.id === profiles.current.id"
              @click="profiles.enter(p, to)"
            >
              <template #prepend>
                <!-- The one in use, while switching — at the gate nobody is in one yet. -->
                <span class="rounded-full p-1" :class="profiles.chosen && p.id === profiles.current.id ? 'ring-3 ring-primary' : ''">
                  <profile-avatar :profile="p" :size="104" />
                </span>
              </template>
              <span class="max-w-36 truncate text-title-medium">{{ profileName(p) }}</span>
            </v-btn>
          </div>

          <template v-if="profiles.chosen && !profiles.current.kids" #actions>
            <v-btn variant="tonal" :prepend-icon="mdiAccountMultipleOutline" :to="localePath('/settings/profiles')">
              {{ $t('Manage profiles') }}
            </v-btn>
          </template>
        </v-empty-state>
      </div>
    </v-main>
  </v-app>
</template>
