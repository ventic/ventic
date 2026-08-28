<script setup lang="ts">
/**
 * The one interruption the app allows itself: a release is out, this copy can
 * actually install it, and the user hasn't already said no to that version.
 *
 * It exists because the alternative doesn't work on a television. The toolbar
 * badge is an 8px dot on an icon, which at ten feet is nothing — the skill's
 * own rule is never to signal state with colour alone at that distance — so on
 * Android TV the update panel was, in practice, undiscoverable. Everything that
 * keeps this from becoming a nag is in `shouldPrompt`: never for an install
 * that can't self-update, never twice in a launch, never again for a version
 * that was skipped. And nothing here decides *where* — it is mounted in the
 * default layout, and the player deliberately has no layout, which is what
 * keeps a dialog off a film.
 *
 * Closing it any other way — Escape, the scrim, BACK on a remote — is "not
 * now", which is the honest reading of walking away from it.
 */
const updates = useUpdatesStore()
</script>

<template>
  <!-- Not `scrollable`: that moves the overflow onto `.v-card-text`, which is
       not an ancestor of the buttons — and `nudge()` scrolls by walking up from
       whatever is focused, so a remote could never reach the notes. Left alone,
       the card itself is the scroller and the footer buttons are inside it. -->
  <v-dialog
    :model-value="updates.shouldPrompt"
    max-width="640"
    @update:model-value="updates.notNow()"
  >
    <v-card rounded="xl">
      <v-card-title class="text-title-medium">
        {{ $t('Ventic {version} is out', { version: updates.available?.version }) }}
      </v-card-title>
      <v-card-text class="pt-0">
        <update-panel>
          <template #dismiss>
            <v-btn variant="text" @click="updates.notNow()">
              {{ $t('Not now') }}
            </v-btn>
            <v-btn variant="text" @click="updates.skip()">
              {{ $t('Skip this version') }}
            </v-btn>
          </template>
        </update-panel>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
