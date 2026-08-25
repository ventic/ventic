/**
 * Is there a newer Ventic than this one, and what can this copy do about it?
 *
 * Two halves that deliberately don't share a transport. *Finding out* is this
 * file: one call to the GitHub API, which every build can make — desktop,
 * Android, and `bun run dev` in a browser. *Applying* it is platform work in
 * `stores/updates.ts`: the updater plugin on the desktop, which fetches
 * `latest.json` and the bundle from Rust, and on Android a DownloadManager fetch
 * of the APK handed to the system installer (MainActivity's `installUpdate`).
 *
 * It has to be the API and not the release file the updater itself reads:
 * `releases/latest/download/…` redirects to release-assets.githubusercontent.com,
 * which answers with no `Access-Control-Allow-Origin` at all, so a webview
 * fetch of it is blocked before it starts. `api.github.com` sends `*`.
 *
 * So the badge means "GitHub has a newer release", which is a fact about the
 * repository and true no matter how the app was installed — and `can_self_update`
 * decides separately whether the button beside it installs or just points at the
 * download. See that command in `src-tauri/src/lib.rs`.
 */

export const REPO = 'ventic/ventic'
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

/**
 * The project's own download page, which is where anyone who has to fetch a
 * build by hand is sent — a `.deb`, an AUR build, a browser. It names the file
 * each platform wants; the GitHub release page is a list of six of them.
 */
export const DOWNLOAD_URL = 'https://ventic.tv/download/'

/**
 * The newest Android package, whichever release it belongs to. Only a fallback:
 * an `Update` carries the APK of the *particular* release we told the user
 * about, and offering a version other than the one named on screen is worse
 * than offering none. This covers a release that shipped without one.
 *
 * https, not http — these bytes go to the package installer, and Android's
 * network config forbids cleartext anyway.
 */
export const APK_URL = 'https://ventic.tv/apk'

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

/**
 * The newest published release, as much of it as anything here needs.
 *
 * Not called `Release`: that name is already the torrent domain's, for one
 * result a source returned (`utils/torrents.ts`), and both are auto-imported
 * into the same namespace. An `Update` is a version of the app.
 */
export interface Update {
  /** No leading `v` — comparable with what `getVersion()` returns. */
  version: string
  /** The release body, verbatim markdown. Shown as plain text; nothing renders it. */
  notes: string
  /** The release page, for builds that can't update themselves. */
  url: string
  /** The Android package on that release, if it carries one. */
  apk: string
}

/**
 * Semver ordering: negative when `a` is older, positive when it is newer.
 *
 * Full prerelease handling rather than a numeric string compare, because a
 * released 0.2.0 has to beat the 0.2.0-rc.1 someone is running — and every
 * shortcut gets that backwards, offering the rc as an upgrade forever or never
 * offering the release at all.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    // Build metadata is explicitly not part of ordering, and a `v` prefix is
    // the tag's, not the version's.
    const [core = '', pre = ''] = v.trim().replace(/^v/, '').split('+')[0]!.split(/-(.*)/)
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
  }
  const x = parse(a)
  const y = parse(b)

  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (d)
      return d
  }

  // Same numbers: anything with a prerelease tag is the older of the two, and
  // having none at all wins outright.
  if (!x.pre.length || !y.pre.length)
    return (y.pre.length ? 1 : 0) - (x.pre.length ? 1 : 0)

  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    // A shorter set of identifiers is the lower one, all else equal.
    if (p === undefined || q === undefined)
      return p === undefined ? -1 : 1
    const [n, m] = [Number(p), Number(q)]
    // Numeric identifiers sort below alphanumeric ones, and numerically
    // among themselves — so rc.9 comes before rc.10, which a string compare
    // gets wrong.
    if (Number.isNaN(n) !== Number.isNaN(m))
      return Number.isNaN(n) ? 1 : -1
    if (!Number.isNaN(n) && n !== m)
      return n - m
    if (p !== q)
      return p < q ? -1 : 1
  }
  return 0
}

/** Is `latest` worth telling the user about, given they are running `current`? */
export function isNewer(current: string, latest: string) {
  return !!current && !!latest && compareVersions(latest, current) > 0
}

/**
 * The fields worth keeping out of a GitHub release object.
 *
 * Separate from the fetch so the check script can feed it a recorded payload —
 * the shape is somebody else's to change, and a rename that silently produced
 * `version: ''` would turn the update badge off with nothing to notice.
 */
export function parseUpdate(data: unknown): Update | null {
  const r = data as {
    tag_name?: string
    body?: string
    html_url?: string
    draft?: boolean
    prerelease?: boolean
    assets?: { name?: string, browser_download_url?: string }[]
  } | null

  const version = r?.tag_name?.trim().replace(/^v/, '') ?? ''
  // `/releases/latest` filters both out already; this is the belt to that
  // braces, since a wrong endpoint would otherwise offer people a draft.
  if (!r || !version || r.draft || r.prerelease)
    return null

  return {
    version,
    notes: r.body?.trim() ?? '',
    url: r.html_url || RELEASES_URL,
    apk: r.assets?.find(a => a.name?.endsWith('.apk'))?.browser_download_url ?? '',
  }
}

/**
 * Ask GitHub what the newest release is. `null` for anything that goes wrong —
 * being offline is the normal case here, not an error worth surfacing.
 */
export async function latestUpdate(): Promise<Update | null> {
  try {
    return parseUpdate(await $fetch(API_URL, {
      // Unauthenticated, so this shares 60 requests an hour with everything else
      // on the same address. One check per launch stays far inside that.
      headers: { Accept: 'application/vnd.github+json' },
      timeout: 10_000,
      retry: 0,
    }))
  }
  catch {
    return null
  }
}
