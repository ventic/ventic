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

/**
 * The release *list*, not `/releases/latest`: someone four versions behind
 * wants to read what they missed, not only what is newest. It costs the same
 * one request a launch, and `parseUpdate` already refuses a draft or a
 * prerelease — which is the filtering `/latest` used to do for us.
 */
const API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`

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
  /** The release body, verbatim markdown. `renderNotes` turns it into markup. */
  notes: string
  /** When it was published, ISO. A changelog of several releases wants dates. */
  date: string
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
    published_at?: string
    html_url?: string
    draft?: boolean
    prerelease?: boolean
    assets?: { name?: string, browser_download_url?: string }[]
  } | null

  const version = r?.tag_name?.trim().replace(/^v/, '') ?? ''
  // The list endpoint hands back both, so this is the filter and not a belt to
  // anyone else's braces: a draft is unpublished and a prerelease is not what
  // the stable channel is for.
  if (!r || !version || r.draft || r.prerelease)
    return null

  return {
    version,
    notes: r.body?.trim() ?? '',
    date: r.published_at ?? '',
    url: r.html_url || RELEASES_URL,
    apk: r.assets?.find(a => a.name?.endsWith('.apk'))?.browser_download_url ?? '',
  }
}

/**
 * A page of the release list, newest first.
 *
 * Sorted by version rather than trusted in the order it arrives: GitHub orders
 * by creation date, and a patch cut from an old branch after a newer release
 * would otherwise sit at the top and be offered as the update.
 */
export function parseUpdates(data: unknown): Update[] {
  return (Array.isArray(data) ? data : [data])
    .map(parseUpdate)
    .filter((u): u is Update => !!u)
    .sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * Ask GitHub what it has published. An empty list for anything that goes wrong —
 * being offline is the normal case here, not an error worth surfacing.
 */
export async function latestUpdates(): Promise<Update[]> {
  try {
    return parseUpdates(await $fetch(API_URL, {
      // Unauthenticated, so this shares 60 requests an hour with everything else
      // on the same address. One check per launch stays far inside that.
      headers: { Accept: 'application/vnd.github+json' },
      timeout: 10_000,
      retry: 0,
    }))
  }
  catch {
    return []
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/**
 * One line of a release body, as inline markup.
 *
 * The escape is first and is the whole of what makes the result safe to hand to
 * `v-html`: everything after it only ever adds tags this function wrote, and it
 * writes **no attributes at all** — so there is nothing for a `"` to break out
 * of and no `href` to point anywhere.
 *
 * A link keeps its label and loses its target on purpose, rather than becoming
 * an `<a>`. Two reasons, and either would be enough: a bare anchor inside the
 * Tauri webview navigates the app itself away from the bundle with no way back
 * (every other link in here goes through `useTauriShellOpen`), and an anchor is
 * a d-pad target — a remote would have to walk every link in a changelog to
 * reach the Update button under it.
 */
function inline(text: string) {
  return text
    .replace(/[&<>"]/g, c => ESCAPES[c]!)
    // GitHub's generated notes credit each change with a full pull request URL,
    // which is thirty unreadable characters on a television. Nothing else here
    // shortens a URL: the rest stay as text and wrap.
    .replace(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g, '#$1')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\([^\s)]*\)/g, '$1')
}

/**
 * A release body as the markup the notes block styles.
 *
 * Deliberately not a markdown library: the smallest is ~35 kB into a bundle a
 * television parses at boot, for one panel — and a release body here is a
 * heading, a bullet and the odd bit of bold.
 *
 * ponytail: line-based, so no nested lists, no tables and no fenced code blocks
 * (a fence renders as its own lines). Reach for a parser if release notes ever
 * need one.
 */
export function renderNotes(markdown: string): string {
  const out: string[] = []
  /**
   * The block being read, held rather than emitted, because a line only says
   * what it belongs to once the *next* one arrives. Markdown wraps freely: a
   * bullet or a paragraph runs until a blank line, a heading or a new bullet,
   * and every line under it belongs to what came before. Emitting per line is
   * the bug that shape produces — every wrapped bullet in a real release body
   * ended the list and started a paragraph halfway through a sentence.
   */
  const held: string[] = []
  let item = false
  let list = false

  const flush = () => {
    if (held.length)
      out.push(item ? `<li>${inline(held.join(' '))}</li>` : `<p>${inline(held.join(' '))}</p>`)
    held.length = 0
  }
  const endList = () => {
    flush()
    if (list)
      out.push('</ul>')
    list = false
    item = false
  }

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()

    // A blank line ends whatever was open. So does a horizontal rule, which has
    // nothing to draw in a block this narrow — and GitHub appends the compare
    // link to every generated body, which is a web page nobody opens from here.
    if (!line || /^([-*_])\1{2,}$/.test(line) || /^\*\*Full Changelog\*\*/i.test(line)) {
      endList()
      continue
    }

    // One whitespace and not `\s+`: with `.*` after it, a repeated class the
    // dot also matches is a backtracking hazard, so the rest is trimmed instead.
    const heading = line.match(/^#{1,6}\s(.*)$/)
    if (heading) {
      endList()
      out.push(`<h4>${inline(heading[1]!.trim())}</h4>`)
      continue
    }

    // Ordered lists come out as bullets: a release body uses the numbers as
    // punctuation, and nothing here reads back an index.
    const bullet = line.match(/^(?:[-*+]|\d+\.)\s(.*)$/)
    if (bullet) {
      flush()
      if (!list)
        out.push('<ul>')
      list = true
      item = true
      held.push(bullet[1]!.trim())
      continue
    }

    // Plain text under an open bullet is that bullet's next line, not a
    // paragraph — markdown's lazy continuation, and what release notes are
    // actually written in. `item` is only ever true inside a list, so the line
    // needs no branch: it joins whichever block is being held.
    held.push(line)
  }

  endList()
  return out.join('')
}
