declare interface ModuleOptions {
  prefix: false | string
}

declare interface Window {
  /**
   * What Android's BACK key calls (see gen/android MainActivity.kt), defined by
   * plugins/dpad.client.ts. `false` means nothing was left to go back to.
   */
  __tvBack?: () => boolean
}
