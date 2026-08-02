import antfu from '@antfu/eslint-config'
import nuxtConfig from './.nuxt/eslint.config.mjs'

export default antfu({
  vue: true,
  typescript: true,
  // The Rust/Tauri side owns its own formatting (rustfmt, generated schemas).
  ignores: ['src-tauri/**'],
}, {
  files: ['**/*.vue'],
  rules: {
    'vue/operator-linebreak': ['error', 'before'],
    // Vuetify's per-column slots are named `item.<key>`, which the rule reads as
    // a modifier on `item`. Vuetify's own docs say to allow it.
    'vue/valid-v-slot': ['error', { allowModifiers: true }],
    'vue/component-name-in-template-casing': ['error', 'kebab-case', {
      registeredComponentsOnly: false,
      ignores: [],
    }],
  },
}, {
  rules: {
    'style/semi': ['error', 'never'],
    'no-console': 'warn',
    'arrow-parens': ['error', 'as-needed'],
    'ts/ban-ts-comment': 'off',
    'style/arrow-parens': 'off',
    'unused-imports/no-unused-vars': 'warn',
    'node/prefer-global/process': 'off',
  },
}, nuxtConfig())
