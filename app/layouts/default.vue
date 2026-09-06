<script setup lang="ts">
// Below `md` the sidebar gives way to a bar along the bottom (AppNav), which is
// where a thumb is and what every phone app does; the sidebar stays a sidebar
// on anything wider, a television included.
const { mobile } = useDisplay()
</script>

<template>
  <v-app>
    <app-background />
    <app-drawer v-if="!mobile" />

    <!-- Here and not in app.vue, which would also cover the player: `watch.vue`
         is the one page with `layout: false`, so mounting the dialog in a layout
         is the whole of what keeps it from landing over a film — a cast arriving
         from another device included, since that is a navigation to the same
         page. Whether it opens at all is `shouldPrompt` in stores/updates.ts. -->
    <update-dialog />
    <!-- The action sheet a card opens, once for the whole app rather than once per card. -->
    <media-menu />

    <!-- The window never scrolls: the shell is a fixed-height column and each
         page scrolls its own content region, so the chrome stays put. -->
    <v-main class="relative z-1 h-dvh">
      <!-- The backdrop art is fixed behind this and stays full-bleed; only the
           content is pulled in off the system bars. With the bar along the
           bottom, that bar is what clears the gesture pill, so the column
           itself only insets the top. -->
      <div class="flex h-full flex-col" :class="mobile ? 'pt-[var(--safe-top)]' : 'safe-inset'">
        <app-bar />
        <!-- data-dpad-start: where a remote picks up focus after a navigation,
             so it lands on the page instead of the toolbar above it. -->
        <div data-dpad-start class="min-h-0 flex-1">
          <slot />
        </div>
        <app-nav v-if="mobile" />
      </div>
    </v-main>
  </v-app>
</template>
