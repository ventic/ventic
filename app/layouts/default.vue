<template>
  <v-app>
    <app-background />
    <app-drawer />

    <!-- Here and not in app.vue, which would also cover the player: `watch.vue`
         is the one page with `layout: false`, so mounting the dialog in a layout
         is the whole of what keeps it from landing over a film — a cast arriving
         from another device included, since that is a navigation to the same
         page. Whether it opens at all is `shouldPrompt` in stores/updates.ts. -->
    <update-dialog />

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
