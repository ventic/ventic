# Vuetify's own labels, where Vuetify has none

Vuetify components render their own strings — `$vuetify.close`, `$vuetify.noDataText`,
the data table's sort announcements — and with `@nuxtjs/i18n` installed those come
out of *our* catalogs. Vuetify ships translations for 39 of the 72 languages here.
For the other 33 a component was rendering a raw `$vuetify.close` key on screen.

One file per missing language, exporting the object those languages were missing.
`scripts/i18n.ts` imports it into the generated catalog exactly the way it imports
Vuetify's own (`import { sl as $vuetify } from 'vuetify/locale'`), so **nothing here
is ever rewritten or deleted by `bun run i18n`** — the script only ever reads the
file name.

## They are partial, and that is the design

Vuetify's English catalog has ~150 strings, most of them for components this app
never mounts: date and time pickers, file upload, pagination footers, hotkey names,
form rules, the video player. Translating those into 33 languages would be 5000
strings nobody will ever see.

What is here is what our components can actually render — `v-select`/`v-autocomplete`,
`v-text-field`, `v-alert`, `v-chip`, `v-badge`, `v-snackbar`, the downloads
`v-data-table` and the theme `v-color-picker`. A key that is missing resolves to
`null` through `i18n.config.ts`'s resolver and falls back to English one key at a
time, which is exactly what all 33 did before — so mounting a `v-date-picker`
tomorrow degrades, it doesn't break.

Adding a key is adding a line. `bun run check:i18n` fails if a key here isn't one
Vuetify actually has, because a typo is a string that silently never renders.
