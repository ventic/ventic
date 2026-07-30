<!-- Settings gets the same shell as the transfer manager: one sidebar, of
     sections instead of the browse nav, and no media search bar. Two menus
     stacked on one screen was the old shape. -->
<template>
  <v-app>
    <app-background />
    <settings-drawer />

    <v-main data-dpad-start class="safe-inset relative z-1 h-dvh">
      <slot />
    </v-main>
  </v-app>
</template>
