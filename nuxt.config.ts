import process from 'node:process'
import vuetifyConfig from './vuetify.config'

const host = process.env.TAURI_DEV_HOST

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  ssr: false,
  devtools: { enabled: false },

  modules: [
    '@vueuse/nuxt',
    '@unocss/nuxt',
    'vuetify-nuxt-module',
    '@nuxt/fonts',
    '@nuxt/eslint',
    '@pinia/nuxt',
  ],
  runtimeConfig: {
    public: {
      TMDB_API: process.env.TMDB_API,
    },
  },
  css: [
    '@/assets/css/layers.css',
  ],

  app: {
    head: {
      title: 'Ventic',
      charset: 'utf-8',
      // viewport-fit=cover is what makes env(safe-area-inset-*) report anything
      // at all — Android draws the app under the status and gesture bars
      // (enableEdgeToEdge in MainActivity.kt), and those insets are how the
      // chrome gets out from under them. See --safe-* in assets/css/layers.css.
      viewport: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
      meta: [
        { name: 'format-detection', content: 'no' },
      ],
      link: [
        { rel: 'icon', href: '/logo.svg' },
      ],
    },
  },

  vuetify: {
    moduleOptions: {
      styles: { configFile: 'app/assets/css/settings.scss' },
      // Vuetify auto-imports a `useLayout` that collides with Nuxt's built-in
      // one, and warns about it on every dev boot. We only ever use these two.
      importComposables: ['useDisplay', 'useTheme'],
    },
    vuetifyOptions: vuetifyConfig,
  },

  // Tauri modules are auto-imported from here (see app/modules/tauri.ts).
  dir: {
    modules: 'app/modules',
  },

  imports: {
    presets: [
      {
        from: 'zod',
        imports: [
          'z',
          { name: 'infer', as: 'zInfer', type: true },
        ],
      },
    ],
  },

  router: {
    options: {
      scrollBehaviorType: 'smooth',
    },
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  experimental: {
    typedPages: true,
  },

  vite: {
    clearScreen: false,
    // Tauri expects TAURI_-prefixed env vars to reach the client.
    envPrefix: ['VITE_', 'TAURI_'],
    server: {
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    optimizeDeps: {
      include: ['@mdi/js'],
    },
  },

  devServer: {
    host: host || '0.0.0.0',
  },

  hooks: {
    /**
     * Mobile is the one target that doesn't load the dev server directly: the
     * webview gets the frontend through Tauri's own `http://tauri.localhost`
     * proxy. Vite's HMR client dials the page's own origin, and a custom
     * protocol can't carry a WebSocket — so on Android the socket never opens.
     *
     * That shows up as a *styling* bug rather than a stale-reload one, because
     * UnoCSS generates utilities as it scans modules and ships everything past
     * the first request over HMR. No socket, no utilities, and the app renders
     * as good as unstyled with no way to reload it by hand.
     *
     * `server.ws.host`/`port` are the documented knob for this, but @nuxt/cli
     * blanks both (`attachViteHmrServer`) to pin the socket to its own dev
     * server — so point the *client* at the loopback address `adb reverse`
     * maps instead, after the CLI has had its say. `clientPort` is needed
     * because `tauri.localhost` has no port for Vite to reuse.
     */
    'vite:configResolved': config => {
      if (host && config.server.ws)
        Object.assign(config.server.ws, { host, clientPort: 3000 })
    },
  },
})
