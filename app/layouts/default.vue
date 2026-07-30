<template>
  <v-app>
    <app-background />
    <app-drawer />

    <!-- The window never scrolls: the shell is a fixed-height column and each
         page scrolls its own content region, so the chrome stays put. -->
    <v-main class="relative z-1 h-dvh">
      <!-- The backdrop art is fixed behind this and stays full-bleed; only the
           content is pulled in off the system bars. -->
      <div class="safe-inset flex h-full flex-col">
        <app-bar />
        <!-- data-dpad-start: where a remote picks up focus after a navigation,
             so it lands on the page instead of the toolbar above it. -->
        <div data-dpad-start class="min-h-0 flex-1">
          <slot />
        </div>
      </div>
    </v-main>
  </v-app>
</template>
