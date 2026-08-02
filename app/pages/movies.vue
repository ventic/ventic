<script setup lang="ts">
// Kept alive so opening a title and coming back lands you where you were —
// same filters, same pages loaded, same scroll (see MediaLayout).
definePageMeta({ keepalive: true })
</script>

<template>
  <media-browser type="movie" />
</template>
