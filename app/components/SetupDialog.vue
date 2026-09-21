<script setup lang="ts">
import type { SetupKind } from '~/utils/cast'

/**
 * The yes an address needs before this app keeps it.
 *
 * Two things stage one and neither may be trusted: a `ventic://` link from a web
 * page (plugins/deeplink.client.ts) and the form a phone posts to this device
 * over the LAN (`setup` in src-tauri/src/cast.rs). One dialog for both, because
 * the rule is the same rule — nothing outside the app changes what it searches,
 * plays or syncs with on its own — and one for all four kinds, because what
 * differs between them is a sentence and the list it lands in.
 *
 * Mounted once by the settings layout: both routes that stage something land on
 * a settings page, and a dialog per page would be four copies of this.
 */
const ui = useUiStore()
const settings = useSettingsStore()
const sync = useSyncStore()

const pending = computed(() => ui.pending)

/**
 * What would actually be kept — the trimmed addon URL, the Xtream login as the
 * API address it becomes. Shown in full: this is the one moment anybody sees
 * what they are agreeing to, and '' is a form that arrived unusable.
 */
const value = computed(() => (pending.value ? setupValue(pending.value) : ''))

/**
 * The address as the dialog prints it. Masked on **both** branches: an Xtream
 * login becomes a URL with the account's password in its query string, a panel's
 * own `get.php` playlist link already is one, and this dialog is read across a
 * room. The invalid branch is the one that matters — that is the address
 * somebody mistyped and is about to read out to whoever is helping them.
 */
const shown = computed(() =>
  (value.value || pending.value?.url || '').replace(/password=[^&]*/gi, 'password=…'))

const COPY: Record<SetupKind, { title: () => string, lead: () => string, note: () => string, action: () => string }> = {
  source: {
    title: () => $t('Add this source?'),
    lead: () => $t('Something asked Ventic to start searching:'),
    note: () => $t('Ventic will send it the title you\'re looking for and play what it hands back. Only add servers you trust — this one is not run by, or checked by, this app.'),
    action: () => $t('Add source'),
  },
  playlist: {
    title: () => $t('Add this playlist?'),
    lead: () => $t('Something asked Ventic to add channels from:'),
    note: () => $t('Its channels will appear under Live TV. A playlist link usually carries your account details, so it is kept out of backups.'),
    action: () => $t('Add playlist'),
  },
  xtream: {
    title: () => $t('Add this Xtream login?'),
    lead: () => $t('Something asked Ventic to add channels from:'),
    note: () => $t('Its channels will appear under Live TV. The password is stored with the address and kept out of backups.'),
    action: () => $t('Add playlist'),
  },
  sync: {
    title: () => $t('Sync with this folder?'),
    lead: () => $t('Something asked Ventic to keep your library in:'),
    note: () => $t('Ventic will read and write one file there. Nothing is uploaded until the next sync, and you can disconnect at any time under Account.'),
    action: () => $t('Use this folder'),
  },
}

const copy = computed(() => COPY[pending.value?.kind ?? 'source'])

function close() {
  ui.pending = null
}

/**
 * Keep it. Each kind lands where that kind is edited by hand, so nothing here
 * is a second implementation of anything — a duplicate is dropped rather than
 * added twice, which is what the Add button would have done on its own page.
 */
function confirm() {
  const setup = pending.value
  if (!setup || !value.value)
    return

  if (setup.kind === 'source') {
    if (!settings.sources.includes(value.value))
      settings.sources = [...settings.sources, value.value]
  }
  else if (setup.kind === 'sync') {
    // A different server is a different history, so the three-way merge starts
    // from nothing rather than from what the last one agreed (see utils/sync).
    Object.assign(sync.config, { url: value.value, user: setup.user ?? '', pass: setup.pass ?? '', base: {}, at: 0 })
  }
  else if (!settings.playlists.includes(value.value)) {
    settings.playlists = [...settings.playlists, value.value]
  }
  close()
}
</script>

<template>
  <!-- Show what arrived, in full, before any of it is kept. Not `persistent`:
       a remote's BACK is an Escape (see plugins/dpad.client.ts), a persistent
       dialog ignores Escape, and a dialog a television cannot back out of is a
       frozen app. Dismissing is a no, which is the safe answer anyway. -->
  <v-dialog :model-value="!!pending" max-width="560" @update:model-value="close">
    <v-card rounded="xl">
      <v-card-title class="text-title-medium">
        {{ copy.title() }}
      </v-card-title>
      <v-card-text class="flex flex-col gap-3">
        <p class="text-body-medium">
          {{ copy.lead() }}
        </p>
        <!-- The address as it will be stored, minus a password — see `shown`. -->
        <code class="break-all rounded-lg bg-surface-container-high px-3 py-2 text-body-small">{{ shown }}</code>
        <p v-if="pending?.user" class="text-body-small opacity-70">
          {{ $t('Username: {name}', { name: pending.user }) }}
        </p>
        <p v-if="!value" class="text-body-small text-error">
          {{ $t('That isn\'t an address Ventic can use. Check what was typed and send it again.') }}
        </p>
        <p v-else class="text-body-small opacity-70">
          {{ copy.note() }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          {{ $t('Cancel') }}
        </v-btn>
        <v-btn variant="tonal" color="primary" :disabled="!value" @click="confirm">
          {{ copy.action() }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
