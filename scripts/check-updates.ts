// Self-check for the update notice: `bun scripts/check-updates.ts`.
//
// Five things worth holding still. The version compare decides whether people
// are told about a release at all — get it backwards and the app either nags
// for ever about a version it already runs, or never mentions one. The GitHub
// release shape is somebody else's to change: a renamed field that quietly
// parsed to an empty version would turn the badge off with nothing anywhere to
// notice. The release notes go to `v-html`, where the escape is the whole
// safety argument. And a dialog that shows itself at launch is one bad
// condition away from being a nag, so every clause that holds it back is
// asserted here, along with the two seams — a layout and a scroll container —
// that no compiler sees. And one APK serves both Google Play and ventic.tv, so
// the last section holds the runtime test that keeps a Play install from trying
// to replace itself with a package signed by the wrong key.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { APK_URL, compareVersions, DOWNLOAD_URL, isNewer, parseUpdate, parseUpdates, RELEASES_URL, renderNotes } from '../app/utils/updates'

// --- Ordering ----------------------------------------------------------------

const older = (a: string, b: string) => assert.ok(compareVersions(a, b) < 0, `${a} < ${b}`)

older('0.1.1', '0.2.0')
older('0.9.0', '0.10.0') // the one a plain string compare gets wrong
older('1.0.0', '1.0.1')
older('0.1.0', '1.0.0')
assert.equal(compareVersions('0.2.0', '0.2.0'), 0)

// A tag carries the `v`; `getVersion()` never does. Both have to compare equal.
assert.equal(compareVersions('v0.2.0', '0.2.0'), 0)
// Build metadata is explicitly not part of the ordering.
assert.equal(compareVersions('0.2.0+abc', '0.2.0'), 0)
// Short forms count the missing parts as zero rather than as anything else.
assert.equal(compareVersions('1.2', '1.2.0'), 0)

// --- Prereleases -------------------------------------------------------------
// `parseUpdate` drops one, so this is really about the side the *user* is
// running: someone on an rc has to be offered the real release.

older('0.2.0-rc.1', '0.2.0')
older('0.2.0-alpha', '0.2.0-beta')
older('0.2.0-rc.9', '0.2.0-rc.10') // numeric identifiers compare as numbers
older('0.2.0-rc', '0.2.0-rc.1') // fewer identifiers is the lower one
older('0.2.0-1', '0.2.0-alpha') // numeric sorts below alphanumeric
older('0.1.9', '0.2.0-rc.1')

// --- What actually gets offered ----------------------------------------------

assert.ok(isNewer('0.1.1', '0.2.0'))
assert.ok(!isNewer('0.2.0', '0.2.0'), 'the version you are running is not an update')
assert.ok(!isNewer('0.3.0', '0.2.0'), 'never offer a downgrade')
// No version means no Tauri — a browser dev session. Nothing to offer there.
assert.ok(!isNewer('', '0.2.0'))
assert.ok(!isNewer('0.1.1', ''))

// --- The GitHub payload ------------------------------------------------------

const release = {
  tag_name: 'v0.2.0',
  body: '  ## What changed\n- things\n  ',
  published_at: '2025-08-12T10:00:00Z',
  html_url: 'https://github.com/ventic/ventic/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'Ventic_0.2.0_amd64.AppImage', browser_download_url: 'https://example.invalid/appimage' },
    { name: 'Ventic_0.2.0.apk', browser_download_url: 'https://example.invalid/apk' },
  ],
}

const parsed = parseUpdate(release)
assert.equal(parsed?.version, '0.2.0', 'the tag\'s v is not part of the version')
assert.equal(parsed?.notes, '## What changed\n- things')
assert.equal(parsed?.url, release.html_url)
// Android needs the one file it can install, not the six the release carries.
assert.equal(parsed?.apk, 'https://example.invalid/apk')

// A release with no APK is a normal state, not a parse failure — the panel
// falls back to the release page.
assert.equal(parseUpdate({ ...release, assets: [] })?.apk, '')
assert.equal(parseUpdate({ ...release, html_url: undefined })?.url, RELEASES_URL)
assert.equal(parseUpdate({ ...release, body: undefined })?.notes, '')
// A changelog of several releases needs to say which is which.
assert.equal(parseUpdate(release)?.date, release.published_at)

// The list endpoint hands both back, and neither may ever be offered.
assert.equal(parseUpdate({ ...release, draft: true }), null)
assert.equal(parseUpdate({ ...release, prerelease: true }), null)

// Anything without a version is not a release, however well-formed the rest is.
for (const bad of [null, undefined, {}, { tag_name: '' }, { tag_name: 'v' }, 'not json'])
  assert.equal(parseUpdate(bad), null, `rejected: ${JSON.stringify(bad)}`)

// --- The list, not just the newest -------------------------------------------
// The endpoint is `/releases`, so drafts and prereleases arrive here rather than
// being filtered by GitHub — and the order is GitHub's, by creation date. A
// patch cut from an old branch after a newer release would otherwise sit at the
// top and be offered to everyone as the update.

const list = parseUpdates([
  { ...release, tag_name: 'v0.1.9' },
  { ...release, tag_name: 'v0.3.0' },
  { ...release, tag_name: 'v0.2.0' },
  { ...release, tag_name: 'v0.4.0-rc.1', prerelease: true },
  { ...release, tag_name: 'v0.9.0', draft: true },
])
assert.deepEqual(list.map(u => u.version), ['0.3.0', '0.2.0', '0.1.9'], 'newest first, published only')

// What the About panel and the dialog both call `available`.
assert.equal(list.filter(u => isNewer('0.1.9', u.version))[0]?.version, '0.3.0')
// And what the changelog shows: everything missed, not only the newest.
assert.deepEqual(
  list.filter(u => isNewer('0.1.9', u.version)).map(u => u.version),
  ['0.3.0', '0.2.0'],
)

// Offline, rate-limited, or an endpoint that changed shape: an empty list, not
// a throw and not a null to unwrap.
assert.deepEqual(parseUpdates(null), [])
assert.deepEqual(parseUpdates([null, {}, 'nonsense']), [])

// --- Release notes as markup -------------------------------------------------
// This goes to `v-html`, so the escape is the whole safety argument: everything
// after it only adds tags renderNotes wrote itself, and it writes no attributes
// at all — nothing for a quote to break out of, and no href to point anywhere.

/**
 * The allowlist, checked as output rather than as intent: every tag the result
 * carries has to be one of the seven, and none of them may carry an attribute.
 * That is the invariant the escape buys, and it is what makes the `v-html` in
 * UpdatePanel.vue safe rather than trusting.
 */
function onlyKnownTags(html: string) {
  for (const tag of html.matchAll(/<\/?([a-z0-9]+)((?:[^a-z0-9>][^>]*)?)>/gi)) {
    assert.ok(['h4', 'ul', 'li', 'p', 'code', 'strong', 'em'].includes(tag[1]!), `<${tag[1]}> in ${html}`)
    assert.equal(tag[2], '', `<${tag[1]}> carries no attributes`)
  }
  return html
}

const hostile = onlyKnownTags(renderNotes('<img src=x onerror="alert(1)"> & "q" <script>alert(2)</script>'))
assert.ok(hostile.includes('&lt;img') && hostile.includes('&amp;') && hostile.includes('&quot;'))

onlyKnownTags(renderNotes('# h\n\n- a\n\ntext `c` **b** *i* [l](https://x.invalid)'))

// A link keeps its label and loses its target: an anchor in the Tauri webview
// navigates the app itself off the bundle with no way back, and every link that
// is meant to work goes through useTauriShellOpen instead.
assert.equal(renderNotes('[the page](https://ventic.tv/download/)'), '<p>the page</p>')
assert.ok(!renderNotes('[x](javascript:alert(1))').includes('javascript'))

// Blocks, as they actually arrive from GitHub's own generator.
assert.equal(renderNotes('## What\'s Changed'), '<h4>What\'s Changed</h4>')
assert.equal(renderNotes('- one\n* two\n1. three'), '<ul><li>one</li><li>two</li><li>three</li></ul>')
// Wrapped prose is one paragraph in markdown, and reads as two if it isn't.
assert.equal(renderNotes('a line\nand its rest'), '<p>a line and its rest</p>')
assert.equal(renderNotes('one\n\ntwo'), '<p>one</p><p>two</p>')

// The one every real release body hits: a bullet wrapped over two lines. Read a
// line at a time it ends the list and starts a paragraph mid-sentence, which is
// what this looked like against the actual notes on GitHub.
assert.equal(
  renderNotes('- one that runs\n  onto the next line\n- two'),
  '<ul><li>one that runs onto the next line</li><li>two</li></ul>',
)
// A blank line does end it, so the paragraph after a list is still a paragraph.
assert.equal(renderNotes('- one\n\nafter'), '<ul><li>one</li></ul><p>after</p>')

// The two bits of noise every generated body carries: a compare link nobody
// opens from a television, and thirty characters of pull request URL.
assert.ok(!renderNotes('**Full Changelog**: https://github.com/ventic/ventic/compare/v1...v2').includes('compare'))
assert.equal(renderNotes('- Fix by @t in https://github.com/ventic/ventic/pull/12'), '<ul><li>Fix by @t in #12</li></ul>')

// --- When the dialog may interrupt -------------------------------------------
// A launch dialog is one bad condition away from being a nag, and none of these
// conditions is visible to a compiler.

const store = readFileSync(new URL('../app/stores/updates.ts', import.meta.url), 'utf8')
const dialog = readFileSync(new URL('../app/components/UpdateDialog.vue', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
const watch = readFileSync(new URL('../app/pages/watch.vue', import.meta.url), 'utf8')

// The rule itself, read as the one statement it is.
const rule = store.slice(store.indexOf('const shouldPrompt')).split('\n\n')[0] ?? ''

// `available` is the release, and `canUpdate` is "only when you can actually
// install it": a .deb, an AUR build or a Nix one can offer nothing but a link
// to a web page, and its package manager has most likely updated it already.
// Those keep the toolbar badge and are never interrupted. `dismissed` is the
// version that was skipped for good, `prompted` the one dialog a launch.
for (const clause of ['available', 'canUpdate', 'dismissed', 'prompted'])
  assert.ok(rule.includes(clause), `shouldPrompt is guarded by ${clause}`)

// Skipping is the answer that outlives a launch; "not now" is the one that
// deliberately doesn't, so it must write nothing.
assert.ok(store.includes('skipped.value = available.value?.version'), 'skip() stores the version')
assert.ok(/function notNow\(\) \{\s*prompted\.value = true\s*\}/.test(store), 'and notNow() stores nothing')

// Never over a film. The dialog is mounted in a layout and the player has no
// layout at all, which is the whole of that guard — a cast arriving from another
// device included, since that is a navigation to this same page.
assert.ok(layout.includes('<update-dialog />'), 'the dialog is mounted in the default layout')
assert.ok(watch.includes('layout: false'), 'and the player takes no layout, so it never sees one')
assert.ok(!readFileSync(new URL('../app/app.vue', import.meta.url), 'utf8').includes('update-dialog'), 'not in app.vue, which would cover the player too')

// Two halves of one seam, and the d-pad on a television is the only thing that
// sees either. `nudge()` scrolls by walking up from whatever is focused, so
// `scrollable` — which moves the overflow onto .v-card-text, no ancestor of the
// buttons — would leave the notes unscrollable from a remote.
assert.ok(
  !dialog.replace(/<!--[\s\S]*?-->/g, '').includes('scrollable'),
  'the dialog card is the scroller, not its text',
)
// And nudge drops focus once it has scrolled, so the press after it starts from
// <body> — with the buttons scrolled off the top and nothing focusable left in
// the dialog, the notes moved once and then never again.
assert.ok(
  /<div v-if="sections\.length" tabindex="0"/.test(
    readFileSync(new URL('../app/components/UpdatePanel.vue', import.meta.url), 'utf8'),
  ),
  'the notes are focusable, so a remote can keep scrolling them',
)

// --- Installing it on Android ------------------------------------------------
// No updater plugin exists there and no app can overwrite its own package, so
// the update is: download the APK, open the system installer on it. That path
// crosses from TS into Kotlin through the VenticScreen bridge, which no compiler
// checks — a method renamed on one side is an Update button that silently does
// nothing, on the one platform where there is no second way to install.

const kotlin = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/java/com/ventic/app/MainActivity.kt', import.meta.url),
  'utf8',
)
const platform = readFileSync(new URL('../app/utils/platform.ts', import.meta.url), 'utf8')
const manifest = readFileSync(
  new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)

for (const method of ['installUpdate', 'updateProgress']) {
  assert.ok(kotlin.includes(`fun ${method}(`), `MainActivity answers ${method}()`)
  assert.ok(platform.includes(`${method}?.(`), `and platform.ts is what calls it`)
}

// Every state the poll can end on has to be one the store knows what to do with.
// A status Kotlin invents and the store doesn't handle reads as a failed
// download in front of a perfectly good file.
for (const state of ['downloading', 'installing', 'failed', 'idle']) {
  assert.ok(kotlin.includes(`"${state}"`), `Kotlin can report ${state}`)
  assert.ok(platform.includes(`'${state}'`), `and ApkInstall lists it`)
}
assert.ok(store.includes(`'installing'`), 'the store has Android\'s end state, which is not the desktop\'s')

// Without the permission the installer refuses to hear from us at all, and
// without the provider path FileProvider throws on the URI it is handed —
// both fail at the last step, after a 100 MB download.
assert.ok(
  manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'),
  'the manifest asks for REQUEST_INSTALL_PACKAGES',
)
assert.ok(
  readFileSync(
    new URL('../src-tauri/gen/android/app/src/main/res/xml/file_paths.xml', import.meta.url),
    'utf8',
  ).includes('external-files-path'),
  'and the FileProvider can lend out the folder the APK lands in',
)

// The bytes go to the package installer, and Android's own network config
// forbids cleartext besides — so a plain-http URL is a download that never
// starts, whichever end refuses it first.
for (const url of [APK_URL, DOWNLOAD_URL, RELEASES_URL])
  assert.ok(url.startsWith('https://'), `${url} is https`)
assert.ok(kotlin.includes('startsWith("https://")'), 'and Kotlin refuses anything else')

// --- Except when Google Play installed it ------------------------------------
// One APK answers both distributions, so *which* route an update takes is
// decided at runtime from the install source. Nothing here is visible to a
// compiler and the failure needs a real store listing to reproduce: Play
// re-signs what it ships, so a Play copy that fetches ventic.tv's APK downloads
// a hundred megabytes and dies at Android's signature check with "App not
// installed" and no reason — and Play's own policy forbids the attempt besides.

const panel = readFileSync(new URL('../app/components/UpdatePanel.vue', import.meta.url), 'utf8')

for (const method of ['installer', 'openStore']) {
  assert.ok(kotlin.includes(`fun ${method}(`), `MainActivity answers ${method}()`)
  assert.ok(platform.includes(`${method}?.(`), `and platform.ts is what calls it`)
}

// The one string the whole decision rests on, spelled the same on both sides of
// a bridge no compiler checks. A typo here is a Play install that quietly goes
// back to updating itself.
for (const [file, name] of [[kotlin, 'Kotlin'], [platform, 'platform.ts']] as const)
  assert.ok(file.includes('com.android.vending'), `${name} knows Play's package name`)

// The gate itself, in the one function every caller goes through.
assert.ok(
  /export function canInstallApk\(\)[\s\S]{0,200}?!fromPlayStore\(\)/.test(platform),
  'canInstallApk() is false on a Play install',
)
// And again in Kotlin — unreachable from our own UI, and there so that a policy
// review can read the rule without unpacking the JavaScript bundle.
assert.ok(
  /fun installUpdate\([\s\S]{0,600}?installer\(\) == PLAY_STORE/.test(kotlin),
  'and installUpdate refuses one outright',
)

// A Play install is the .deb case, not the Android one: Play has most likely
// updated the app already, so it keeps the badge and is never interrupted. That
// is exactly what leaving `play` out of `canUpdate` buys, and folding it in
// would turn the store link into a launch dialog.
assert.ok(store.includes('const play = computed(() => fromPlayStore())'), 'the store exposes it')
const canUpdateLine = store.split('\n').find(l => l.includes('const canUpdate =')) ?? ''
assert.ok(canUpdateLine && !canUpdateLine.includes('play'), 'and canUpdate leaves it out, so no dialog interrupts')

// The panel's one remaining job: point "get it yourself" at the store. An
// intent and not a URL — `market://` means nothing to a webview, and the https
// form opens a browser on top of the app instead of the Play app.
assert.ok(panel.includes('openStore()'), 'the panel opens the listing rather than a download')
assert.ok(panel.includes('updates.play'), 'and asks the store which copy this is')

console.log('check-updates: ok')
