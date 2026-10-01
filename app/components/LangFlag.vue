<script lang="ts" setup>
/**
 * A language's flag, or an empty slot the same width so the names beside it
 * still line up. Which flag is `langFlag`'s to say.
 */
const props = defineProps<{ code?: string }>()

// Not `icon`: a setup binding of that name is what `<icon>` below would
// resolve to, and the flag's name would be rendered as a tag.
const { flags } = useRuntimeConfig().public
const flag = computed(() => langFlag(props.code ?? '', flags))
</script>

<template>
  <icon v-if="flag" :name="flag" size="22" class="shrink-0" />
  <span v-else class="inline-block w-[22px] shrink-0" />
</template>
