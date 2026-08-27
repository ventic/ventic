// Self-check for casting: `bun scripts/check-cast.ts`.
//
// Casting is one small piece of logic surrounded by seams no compiler sees: a
// port number written in Rust, TypeScript and Kotlin; a localStorage key that
// must never leave in a backup; a `release()` call that must not run. The piece
// of logic is the URL rewrite — get that wrong and the receiving device is sent
// its *own* loopback address, which resolves happily and plays nothing.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { CAST_PORT, castable, castRoute, castUrl, MIRROR_PORT, mirrored, newCode, subnet } from '../app/utils/cast'
import { ENGINE } from '../app/utils/torrents'
import './i18n-stub'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// --- The rewrite --------------------------------------------------------------

const MIRROR = 'http://192.168.1.5:3231'

// The engine's own stream, re-pointed at the mirror: same path, same file, a
// different door. Sending the loopback URL as-is is the bug this exists for —
// the other device would resolve it to its own engine and find nothing there.
assert.equal(
  castUrl(`${ENGINE}/torrents/3/stream/0`, MIRROR),
  'http://192.168.1.5:3231/torrents/3/stream/0',
)
assert.ok(!castUrl(`${ENGINE}/torrents/3/stream/0`, MIRROR)!.includes('127.0.0.1'))

// A debrid link or a live channel is already fetchable from anywhere.
const link = 'https://example.invalid/some/film.mkv'
assert.equal(castUrl(link, MIRROR), link)
assert.equal(castUrl('http://example.invalid/live/one.m3u8', MIRROR), 'http://example.invalid/live/one.m3u8')

// A file the user attached from this machine's own disk. Nothing on the other
// device can open it, and the button is not drawn rather than failing late.
assert.equal(castUrl('/home/someone/Films/thing.mkv', MIRROR), null)
assert.equal(castUrl('C:\\Users\\someone\\thing.mkv', MIRROR), null)

// `castable` is what the button asks, so it has to agree with what would happen.
for (const src of [`${ENGINE}/torrents/1/stream/0`, link, '/home/someone/a.mkv', 'C:\\a.mkv'])
  assert.equal(castable(src), castUrl(src, MIRROR) !== null, `castable disagrees for ${src}`)

// --- Finding the other device -------------------------------------------------

const found = subnet('192.168.1.5')
assert.equal(found.length, 253, 'a /24 minus ourselves')
assert.ok(found.includes('192.168.1.1') && found.includes('192.168.1.254'))
assert.ok(!found.includes('192.168.1.5'), 'probing ourselves would offer this device as a target')
assert.ok(!found.includes('192.168.1.0') && !found.includes('192.168.1.255'), 'network and broadcast are not hosts')

// Nothing to sweep rather than a list of malformed addresses.
for (const bad of ['', 'fe80::1', '192.168.1', '192.168.1.999', 'not.an.ip.at.all'])
  assert.deepEqual(subnet(bad), [], `${bad} is not a v4 address`)

for (let i = 0; i < 200; i++)
  assert.match(newCode(), /^\d{4}$/, 'a code is read off a television and typed on a phone')

// --- What the receiving device is told ----------------------------------------

const route = castRoute({
  url: 'http://192.168.1.5:3231/torrents/3/stream/0',
  kind: 'tv',
  id: '1399',
  season: 2,
  episode: 9,
  title: 'Some Show',
  position: 1421.7,
})
assert.equal(route.url, 'http://192.168.1.5:3231/torrents/3/stream/0')
assert.equal(route.type, 'tv', 'watch.vue reads `type`, and anything but \'tv\' is a movie')
assert.equal(route.id, '1399')
assert.equal(route.s, '2')
assert.equal(route.e, '9')
assert.equal(route.t, '1421', 'a whole number of seconds, so the URL is readable')

// A movie, from the top. Empty values are left out rather than sent blank: the
// player reads `?id=` as a title it should look up.
const bare = castRoute({ url: link, kind: 'movie', id: '', season: 0, episode: 0, title: '', position: 0.4 })
assert.deepEqual(Object.keys(bare).sort(), ['type', 'url'])
assert.equal(bare.t, undefined, 'under a second is the start of the film, not a resume point')

// --- Seams no compiler sees ---------------------------------------------------

const rust = read('src-tauri/src/cast.rs')
const kotlin = read('src-tauri/gen/android/app/src/main/java/com/ventic/app/Downloads.kt')
const backup = read('app/utils/backup.ts')
const settings = read('app/stores/settings.ts')
const watch = read('app/pages/watch.vue')

// The port the sender knocks on is the port the receiver opens.
const receiver = /RECEIVER_PORT: u16 = (\d+)/.exec(rust)
assert.ok(receiver, 'cast.rs must name the receiver port')
assert.equal(
  Number(receiver[1]),
  CAST_PORT,
  'CAST_PORT in utils/cast.ts and RECEIVER_PORT in cast.rs are the same port',
)

// …and the port Android watches for "a cast is being served" is the mirror's.
const mirror = /MIRROR_PORT: u16 = (\d+)/.exec(rust)
assert.ok(mirror, 'cast.rs must name the mirror port')
assert.equal(
  Number(mirror[1]),
  MIRROR_PORT,
  'MIRROR_PORT in utils/cast.ts and in cast.rs are the same port — the wrong one here names '
  + 'the wrong port in the one message that tells somebody what to open',
)
assert.ok(
  kotlin.includes(`http://127.0.0.1:${mirror[1]}`),
  'Downloads.kt polls the mirror to know a cast is running — a stale port there means the '
  + 'process is frozen mid-film with no error anywhere',
)
assert.ok(
  /state\.count == 0 && !state\.casting/.test(kotlin),
  'the foreground service must stay up for a cast with nothing downloading',
)

// The exposed engine is read-only. Without this, anything on the network can
// add and delete torrents on a device that was only asked to play a film.
assert.ok(
  /read_only: true/.test(rust),
  'the LAN mirror must be read-only — it is reachable by everything on the network',
)
// And a command is refused before the page hears about it. The network is not
// a permission: without this, anyone on the Wi-Fi can play anything on your TV.
assert.ok(
  /command\.code != state\.code/.test(rust) && /StatusCode::FORBIDDEN/.test(rust),
  'a play command must be checked against the pairing code',
)
assert.ok(
  /command\.code = String::new\(\)/.test(rust),
  'the code must be blanked before the command reaches the page',
)

// A film the receiving device cannot fetch is refused while the sender is still
// on screen to be told. Without this the only complaint appears on a television
// across the room, and it blames the link rather than the firewall in front of
// it — which is a bug report nobody can act on.
assert.ok(
  /if !reachable\(&command\.url\)\.await \{[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*return StatusCode::BAD_GATEWAY/.test(rust),
  'the receiver must refuse a film it cannot reach, before the page is sent anywhere',
)
assert.ok(
  rust.indexOf('reachable(&command.url)') < rust.indexOf('state.app.emit'),
  'and refuse it before emitting, or the player starts anyway and the answer is moot',
)

// Which of the two answers the sender gives depends on whose film it is: only a
// URL this device is serving can be blocked by this device's own firewall.
assert.ok(mirrored(`http://192.168.1.5:${MIRROR_PORT}/torrents/3/stream/0`), 'ours to serve, ours to unblock')
assert.ok(!mirrored(link), 'a debrid link is not this device\'s firewall to answer for')
assert.ok(!mirrored('http://192.168.1.5:8096/stream'), 'another server on the LAN is not the mirror')
assert.ok(!mirrored('/home/someone/a.mkv'), 'not a URL at all')

// A pairing code that travelled in a backup would be a code its reader can cast
// with, and the remembered target carries one too.
for (const key of ['castCode', 'castTarget'])
  assert.ok(new RegExp(`SECRET[^\\n]*${key}`).test(backup), `ventic.${key} must be in backup.ts's SECRET set`)

// Off unless asked for: it opens a port, and a television anyone on the Wi-Fi
// can interrupt is not one anybody wants.
assert.ok(
  /useLocalStorage\('ventic\.castReceive', false\)/.test(settings),
  'casting to a device is opt-in',
)

// The remembered device is an object with a `null` default, which is the one
// default VueUse cannot guess a serializer from — left to guess it writes
// `String(value)`, so the device came back as the string "[object Object]",
// `pick` read `undefined` off it, and the dialog threw while rendering
// `!address.trim()`. Casting worked once per install and never again.
assert.ok(
  /castTarget = useLocalStorage<[^>]*>\(\s*'ventic\.castTarget',\s*null,\s*\{ serializer: StorageSerializers\.object \},/.test(settings),
  'ventic.castTarget must name its serializer — a null default makes VueUse store the device as "[object Object]"',
)

// The torrent the other device is reading from must not be paused on the way
// out of the player — `release()` does exactly that.
assert.ok(
  /if \(!castTo\.value\)[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*downloads\.release\(\)/.test(watch),
  'leaving the player while casting must not pause the torrent being served',
)

// Stop has to reach the other device. Without the route and the listener, the
// film carries on there until the mirror it was reading from goes down, and
// then reads as the network failing rather than as the Stop that was pressed.
assert.ok(/\.route\("\/ventic\/stop", post\(stop\)\)/.test(rust), 'the receiver must answer a stop command')
assert.ok(/cast:\/\/stop/.test(rust), 'stop is emitted to the page')
assert.ok(
  /listen\('cast:\/\/stop'/.test(read('app/plugins/cast.client.ts')),
  'the receiving page must act on a stop, or Stop only stops the sending half',
)

// Both Stop buttons, one implementation. The player's own button goes with the
// player — leaving it is the ordinary way to use a cast — so *Settings →
// Network* is where a cast is stopped most of the time, and it used to stop
// only the serving half and leave the film playing on the other device.
for (const screen of ['app/pages/watch.vue', 'app/pages/settings/network.vue'])
  assert.ok(/stopCast\(/.test(read(screen)), `${screen} must stop a cast through stopCast`)

// …and the order inside it: telling the other device *after* the mirror is gone
// is telling a screen that has already lost the film.
const teardown = /export async function stopCast[\s\S]*?\n\}/.exec(read('app/utils/cast.ts'))?.[0] ?? ''
assert.ok(
  teardown.indexOf('sendStop') < teardown.indexOf('shareEngine'),
  'stopCast tells the other device before it stops serving the film',
)

// The firewall hint is Linux's alone: Windows and macOS ask at bind time and
// Android has no firewall. A hint on those is a command that does nothing.
assert.ok(
  /#\[cfg\(target_os = "linux"\)\][\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*\{[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*let IpAddr::V4/.test(rust),
  'cast_firewall_hint is gated to Linux',
)
assert.ok(
  /ufw allow from \{subnet\} to any port \{MIRROR_PORT\}/.test(rust),
  'the hint names the mirror port and the subnet, not a bare `allow`',
)

// The one that already went wrong once: the handed-over position must be read
// off the player. The library only writes a resume point on a pause or on the
// way out, and `resumeAt` throws away anything under a minute — so a film cast
// twenty minutes in, never paused, started the television from the top.
assert.ok(
  /position: player\.value\?\.position/.test(watch),
  'the cast position comes off the live player',
)
assert.ok(
  !/castPlay[\s\S]{0,400}resumeAt/.test(watch),
  'the cast position must not come from the library resume point',
)

// Two `defineExpose` calls in one <script setup> do not merge — the second
// replaces the first, silently, taking `osd` or `position` with it.
assert.equal(
  (read('app/components/MpvPlayer.vue').match(/defineExpose\(/g) ?? []).length,
  1,
  'MpvPlayer exposes everything through one defineExpose',
)

console.log('cast: ok')
process.exit(0)
