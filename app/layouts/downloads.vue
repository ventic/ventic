<!-- The transfer manager gets its own shell: a sidebar of state filters instead
     of the browse nav, and no media search bar. -->
<template>
  <v-app>
    <app-background />
    <downloads-drawer />

    <v-main data-dpad-start class="safe-inset relative z-1 h-dvh">
      <slot />
    </v-main>
  </v-app>
</template>
