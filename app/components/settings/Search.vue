<script setup lang="ts">
/**
 * The settings search box: the sidebar's, or on a phone the one over the list
 * of sections (pages/settings.vue), which shows the results.
 *
 * What is typed is kept in the route (`?q=`), so Back from a result returns to
 * the results and a reload keeps them — but through a ref of its own, because a
 * navigation per keystroke lands after the next keystroke, and a field bound to
 * the route would be handed the older text back mid-word. The first letter
 * pushes an entry — Back is how a remote leaves the results — and the rest
 * replace it; emptying the box steps back off it again rather than leaving the
 * same page in history twice.
 */
const route = useRoute()
const router = useRouter()
const routed = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const query = ref(routed.value)

watch(routed, q => (query.value = q))
watchDebounced(query, q => {
  if (q === routed.value)
    return
  if (q)
    return routed.value ? router.replace({ query: { q } }) : router.push({ query: { q } })
  const back = window.history.state?.back
  if (typeof back === 'string' && router.resolve(back).path === route.path)
    router.back()
  else
    router.replace({ query: {} })
}, { debounce: 150 })

/**
 * Enter in the box — a remote's on-screen keyboard sends it from its Search
 * key — goes on to the first result. A field keeps left and right for its
 * caret, so there is otherwise no straight way from typing to the results
 * beside it. Once they are the results for what was typed, not the last
 * debounce's — and the first search of a session also waits on the pages'
 * source before there are any.
 */
async function toResults() {
  await until(() => routed.value === query.value).toBe(true, { timeout: 1000 })
  for (let tries = 0; tries < 30; tries++) {
    const first = document.querySelector<HTMLElement>('[data-settings-results] a')
    if (first)
      return first.focus()
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
</script>

<template>
  <search-field v-model="query" :placeholder="$t('Search settings')" @enter="toResults" />
</template>
