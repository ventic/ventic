import * as tauriApp from '@tauri-apps/api/app'
import * as tauriWebviewWindow from '@tauri-apps/api/webviewWindow'
import * as tauriDeepLink from '@tauri-apps/plugin-deep-link'
import * as tauriDialog from '@tauri-apps/plugin-dialog'
import * as tauriFs from '@tauri-apps/plugin-fs'
import * as tauriNotification from '@tauri-apps/plugin-notification'
import * as tauriOs from '@tauri-apps/plugin-os'
import * as tauriProcess from '@tauri-apps/plugin-process'
import * as tauriShell from '@tauri-apps/plugin-shell'
import * as tauriStore from '@tauri-apps/plugin-store'
import * as tauriUpdater from '@tauri-apps/plugin-updater'
import { addImports, defineNuxtModule } from 'nuxt/kit'

function capitalize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const tauriModules = [
  { module: tauriApp, prefix: 'App', importPath: '@tauri-apps/api/app' },
  { module: tauriWebviewWindow, prefix: 'WebviewWindow', importPath: '@tauri-apps/api/webviewWindow' },
  { module: tauriShell, prefix: 'Shell', importPath: '@tauri-apps/plugin-shell' },
  { module: tauriOs, prefix: 'Os', importPath: '@tauri-apps/plugin-os' },
  { module: tauriNotification, prefix: 'Notification', importPath: '@tauri-apps/plugin-notification' },
  { module: tauriFs, prefix: 'Fs', importPath: '@tauri-apps/plugin-fs' },
  { module: tauriStore, prefix: 'Store', importPath: '@tauri-apps/plugin-store' },
  { module: tauriDialog, prefix: 'Dialog', importPath: '@tauri-apps/plugin-dialog' },
  { module: tauriDeepLink, prefix: 'DeepLink', importPath: '@tauri-apps/plugin-deep-link' },
  // Desktop-only plugins: the crates behind these are not built for Android
  // (see Cargo.toml), so calling either there throws. `can_self_update` is what
  // decides whether anything may — see stores/updates.ts.
  { module: tauriUpdater, prefix: 'Updater', importPath: '@tauri-apps/plugin-updater' },
  { module: tauriProcess, prefix: 'Process', importPath: '@tauri-apps/plugin-process' },
]

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-tauri',
    configKey: 'tauri',
  },
  defaults: {
    prefix: 'useTauri',
  },
  setup(options) {
    tauriModules.forEach(({ module, prefix, importPath }) => {
      Object.keys(module).filter(name => name !== 'default').forEach(name => {
        const prefixedName = `${options.prefix}${prefix}` || ''
        const as = prefixedName ? prefixedName + capitalize(name) : name
        addImports({ from: importPath, name, as })
      })
    })
  },
})
