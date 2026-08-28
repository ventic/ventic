// `$t` for the check scripts, which run the app's pure functions under `bun`
// with no Nuxt around them to auto-import it.
//
// The identity is honest rather than a shim: value-as-key means the English
// text *is* the key, so returning the key returns exactly what the app renders
// in its default language — which is what those asserts were ever checking.
// Interpolation is filled in for the same reason.
//
// Import it for its side effect, before anything that reaches app/utils:
//   import './i18n-stub'
;(globalThis as { $t?: (key: string, values?: Record<string, unknown>) => string }).$t
  = (key, values) => key.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''))

// The same answer the real one gives with no document to read a `lang` off,
// which is exactly the situation here.
;(globalThis as { uiLocale?: () => string }).uiLocale = () => 'en-US'

export {}
