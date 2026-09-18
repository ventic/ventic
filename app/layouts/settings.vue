<!-- Settings gets the same shell as the transfer manager: one sidebar, of
     sections instead of the browse nav, and no media search bar. Two menus
     stacked on one screen was the old shape. A phone gets no sidebar at all —
     the list of sections is a page there (pages/settings/index.vue). -->
<script setup lang="ts">
const { mobile } = useDisplay()
</script>

<template>
  <v-app>
    <app-background />
    <settings-drawer v-if="!mobile" />

    <!-- An address that arrived from outside — a `ventic://` link, or what a
         phone typed into the form the TV serves — waiting for a yes. Here
         because both of those land on a settings page, and a copy per page
         would be four of them. -->
    <setup-dialog />

    <v-main data-dpad-start class="safe-inset relative z-1 h-dvh">
      <slot />
    </v-main>
  </v-app>
</template>
