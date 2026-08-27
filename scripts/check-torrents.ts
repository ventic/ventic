import assert from 'node:assert'
import process from 'node:process'
import { diskBudget, ENGINE, findReleases, haveAt, isAwkward, isBloated, normalizeSource, parseRelease, pickBest, pickSubtitleFiles, pickVideoFile, planEviction, planNetwork, releaseKey, setQuality, setSources, startTorrent, streamParts, toRelease, uploadLimit, usedBytes } from '../app/utils/torrents'
// Self-check for the torrent parser/ranker: `bun scripts/check-torrents.ts`.
// The fixture is the response shape a source answers with, filled in with a
// public-domain film. `--live <source-url> <imdb-id>` also searches for real.
import './i18n-stub'

const streams = [
  {
    name: 'Example\n4k HDR',
    title: 'Sintel 2010 Bluray 2160p AV1 HDR10\n👤 96 💾 8.91 GB ⚙️ indexer-a',
    infoHash: 'aaa',
    fileIdx: 0,
  },
  {
    name: 'Example\n1080p',
    title: 'Sintel.2010.1080p.BluRay.x264\n👤 40 💾 2.1 GB ⚙️ indexer-b',
    infoHash: 'bbb',
    fileIdx: 3,
    sources: ['tracker:udp://private.example:6969/announce', 'dht:bbb'],
  },
  {
    name: 'Example\n1080p',
    title: 'Sintel.2010.1080p.WEB-DL\n👤 900 💾 66.25 GB ⚙️ indexer-a', // remux: too big to stream
    infoHash: 'ccc',
  },
  {
    name: 'Example\n1080p',
    title: 'Sintel.2010.1080p.HDCAM\n👤 5000 💾 1.5 GB ⚙️ indexer-c', // junk, whatever the seeders
    infoHash: 'ddd',
  },
  {
    name: 'Example\n720p',
    title: 'Sintel 2010 720p BRrip\n👤 170 💾 464.62 MB ⚙️ indexer-b',
    infoHash: 'eee',
  },
  {
    name: 'Example\n1080p',
    // Same tier as bbb, far more seeders, but 12 GB buys nothing on a stream.
    title: 'Sintel.2010.1080p.BluRay.REMUX\n👤 4000 💾 12 GB ⚙️ indexer-a',
    infoHash: 'fff',
  },
]

const parsed = streams.flatMap(s => toRelease(s) ?? [])
assert.equal(parsed.length, 5, 'the HDCAM release is dropped')

const [uhd, hd] = parsed
assert.equal(uhd!.seeders, 96)
assert.equal(uhd!.size, '8.91 GB')
assert.equal(uhd!.source, 'indexer-a')
assert.equal(uhd!.quality, '4k HDR')
assert.equal(hd!.bytes, 2.1 * 1024 ** 3)
assert.equal(hd!.fileIdx, 3)
assert.ok(hd!.magnet.startsWith('magnet:?xt=urn:btih:bbb&dn=Sintel.2010.1080p.BluRay.x264&tr='))
assert.ok(hd!.magnet.includes(encodeURIComponent('udp://private.example:6969/announce')), 'keeps the release\'s own tracker')
assert.ok(hd!.magnet.includes(encodeURIComponent('udp://tracker.opentrackr.org:1337/announce')), 'adds the public ones')

// 1080p beats 4k and 720p; the 66 GB remux with 900 seeders is still skipped,
// and the 12 GB one loses to the 2.1 GB copy of the same tier despite 100x the
// seeders — bitrate that size buys can't be streamed anyway.
assert.equal(pickBest(parsed)!.hash, 'bbb')
assert.equal(pickBest([]), null)
// Nothing streamable (all junk/oversized) must report nothing, not a bad pick.
assert.equal(pickBest(parsed.filter(t => t.hash === 'ccc')), null)
// With no sane-sized 1080p left, the fat one still beats dropping a tier.
assert.equal(pickBest(parsed.filter(t => ['fff', 'eee'].includes(t.hash)))!.hash, 'fff')

// --- Links a source resolved itself -------------------------------------------
// The same protocol carries plain HTTP streams: a debrid addon has already
// fetched the torrent on its own servers and answers with a link to the file.
// There is no swarm behind one and nothing lands on this device, so neither the
// seeder count nor the storage budget has anything to say about it.

const linkStreams = [
  {
    name: 'Example\n1080p',
    // `description` is what `title` was renamed to; addons emit one or the other.
    description: 'Sintel.2010.1080p.WEB-DL\n👤 0 💾 2.2 GB ⚙️ debrid',
    url: 'https://debrid.example/dl/abc/Sintel.mkv',
  },
  {
    name: 'Example\n1080p',
    title: 'Sintel.2010.1080p.BluRay.x264\n👤 40 💾 2.1 GB ⚙️ indexer-b',
    infoHash: 'bbb',
  },
  // An addon serving its own files draws no stats line, and says the size here.
  {
    name: 'Example\n720p',
    title: 'Sintel.2010.720p.WEB',
    url: 'https://host.example/sintel-720.mp4',
    behaviorHints: { videoSize: 900_000_000 },
  },
  // Neither a torrent nor a link this app can open: a handoff to another player.
  { name: 'Example', title: 'Sintel', url: 'magnet:?xt=urn:btih:zzz' },
  { name: 'Example', title: 'Sintel' },
]
const links = linkStreams.flatMap(s => toRelease(s) ?? [])
assert.equal(links.length, 3, 'a stream with neither an info hash nor an http link is dropped')

const [debrid, sameTier, hosted] = links
assert.equal(debrid!.url, 'https://debrid.example/dl/abc/Sintel.mkv')
assert.equal(debrid!.hash, '', 'a link has no info hash')
assert.equal(debrid!.magnet, '', 'and nothing to hand the engine')
assert.equal(debrid!.bytes, 2.2 * 1024 ** 3, 'the stats line parses out of `description` too')
assert.equal(hosted!.bytes, 900_000_000, 'and out of behaviorHints where there is no stats line')
assert.equal(hosted!.size, '858.3 MB')
// Identity is the hash for a torrent and the link itself for a link — dedupe,
// list keys and the "already added" mark all hang on it.
assert.equal(releaseKey(debrid!), debrid!.url)
assert.equal(releaseKey(sameTier!), 'bbb')

// Same tier, same size class: the copy that needs no swarm wins. Its zero
// seeders would have dropped it outright before — that filter is about torrents.
assert.equal(pickBest(links)!.url, debrid!.url)
// …but a link is never worth a whole quality tier, same as everything else.
assert.equal(pickBest([sameTier!, hosted!])!.hash, 'bbb', 'a 1080p torrent beats a 720p link')
// A device with no room left can still play one: nothing is written to it.
assert.equal(pickBest(links, 100)!.url, debrid!.url, 'the storage budget is not its business')
assert.equal(pickBest([sameTier!], 100), null, 'which a torrent does not get away with')

// --- A drive that caps one file ----------------------------------------------
// A TV formats a USB stick as FAT32, which stops at 4 GiB however much of the
// drive is free. The store hands that down as `maxBytes` (see the downloads
// store), so it is the same ceiling the disk budget uses — a release over it is
// dropped rather than downloaded to the 4 GiB mark and abandoned there.
const FAT32 = 4 * 1024 ** 3 - 1
// The 8.91 GB 4k copy is out, the 2.1 GB 1080p one is not.
assert.equal(pickBest(parsed, FAT32)!.hash, 'bbb', 'the cap drops what will not fit')
assert.equal(
  pickBest(parsed.filter(t => t.hash === 'aaa'), FAT32),
  null,
  'and leaves nothing rather than a release that dies at 4 GiB',
)
// Still not a link's problem: it never touches the drive that has the limit.
assert.equal(pickBest(links, FAT32)!.url, debrid!.url, 'a direct link is exempt from it')

// A player that is the system webview (Android, macOS) has the device's codecs
// and no others, so between two equal releases it takes the one it can decode —
// but not at the cost of a whole quality tier.
const codecs = [
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.WEB-DL.x265.10bit.DDP5.1\n👤 900 💾 2.8 GB ⚙️ a', infoHash: 'h265' },
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.WEB-DL.x264.AAC\n👤 120 💾 2.4 GB ⚙️ b', infoHash: 'h264' },
  { name: 'Example\n720p', title: 'Sintel.2010.720p.WEB.x264\n👤 40 💾 1.1 GB ⚙️ b', infoHash: 'sd' },
].flatMap(s => toRelease(s) ?? [])

assert.equal(pickBest(codecs)!.hash, 'h265', 'mpv plays anything, so seeders decide')
assert.equal(pickBest(codecs, undefined, true)!.hash, 'h264', 'a webview takes the one it can decode')
assert.equal(
  pickBest(codecs.filter(t => t.hash !== 'h264'), undefined, true)!.hash,
  'h265',
  'still not worth dropping to 720p over',
)
assert.ok(isAwkward(codecs[0]!) && !isAwkward(codecs[1]!))

// --- A label is not a bitrate ------------------------------------------------
// Every copy in a search is the same film, so the tier's own median is what
// "1080p" weighs for this one. The 700 MB entry is 1080p by frame size and by
// nothing else, and no number of seeders makes it the pick.
const sameFilm = [
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.WEB.x264\n👤 900 💾 700 MB ⚙️ a', infoHash: 'mush' },
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.BluRay.x264\n👤 40 💾 2.2 GB ⚙️ b', infoHash: 'good' },
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.WEB-DL.x264\n👤 30 💾 2.4 GB ⚙️ c', infoHash: 'also' },
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.BluRay.x265\n👤 20 💾 2.6 GB ⚙️ d', infoHash: 'more' },
].flatMap(s => toRelease(s) ?? [])

assert.equal(pickBest(sameFilm)!.hash, 'good', 'a starved copy loses its tier, whatever its seeders')
assert.equal(
  pickBest(sameFilm.slice(0, 2))!.hash,
  'mush',
  'two copies are each other\'s outlier — with no sample there is no verdict',
)

// --- The tier you asked for, when it is really there --------------------------
const swarms = [
  { name: 'Example\n4k HDR', title: 'Sintel.2010.2160p.WEB-DL\n👤 2 💾 15 GB ⚙️ a', infoHash: 'uhd' },
  { name: 'Example\n1080p', title: 'Sintel.2010.1080p.WEB-DL\n👤 200 💾 2.4 GB ⚙️ b', infoHash: 'hd' },
].flatMap(s => toRelease(s) ?? [])

setQuality('2160p')
assert.equal(pickBest(swarms)!.hash, 'hd', 'a 4k two people are seeding loses to a healthy 1080p')
assert.equal(
  pickBest(swarms.filter(t => t.hash === 'uhd'))!.hash,
  'uhd',
  'and is still played when it is the only thing there',
)
assert.equal(pickBest(parsed)!.hash, 'aaa', 'a live 4k is taken when one was asked for')
// "4k" and "2160p" are one tier under two labels, so the fat cap is the 4k one.
assert.ok(!isBloated(swarms[0]!), '15 GB is not a bloated 2160p')
setQuality('')
assert.equal(pickBest(parsed)!.hash, 'bbb', 'and the streaming default comes back')

// ...but the name is only half of it. With a device to ask — Android, where the
// player is ExoPlayer on the platform's own decoders — the answer comes from
// what it actually has, and a TV box with Dolby and HEVC keeps the release a
// phone would have been steered off. Left installed on purpose: nothing below
// asks about codecs, and `deviceCodecs` caches for the life of the process.
;(globalThis as any).VenticPlayer = { codecs: () => JSON.stringify(['audio/eac3', 'video/hevc']) }
assert.ok(!isAwkward(codecs[0]!), 'a decoder it has is not a codec to avoid')
assert.equal(pickBest(codecs, undefined, true)!.hash, 'h265', 'so it stops taking the x264 copy')

const files = [
  { name: 'readme.txt', length: 30, included: true },
  { name: 'Sample/sample.mkv', length: 40_000_000, included: true },
  { name: 'Sintel.2010.1080p.mkv', length: 2_100_000_000, included: true },
]
assert.equal(pickVideoFile(files, null), 2, 'largest video wins when there is no hint')
assert.equal(pickVideoFile(files, 1), 1, 'a hint pointing at a video is trusted')
assert.equal(pickVideoFile(files, 0), 2, 'a hint pointing at a .txt is not')
assert.equal(pickVideoFile([{ name: 'readme.txt', length: 1, included: true }], null), null)

// A season pack: the episode you asked for, not the biggest file in the pack.
const pack = [
  { name: 'Example.Show.S01E01.1080p.mkv', length: 3_000_000_000, included: true },
  { name: 'Example.Show.S01E02.1080p.mkv', length: 2_000_000_000, included: true },
  { name: 'Example.Show.S01E10.1080p.mkv', length: 2_500_000_000, included: true },
]
assert.equal(pickVideoFile(pack, null, { season: 1, episode: 2 }), 1, 'matches S01E02 by name')
assert.equal(pickVideoFile(pack, 0, { season: 1, episode: 2 }), 1, 'the name beats a stale hint')
assert.equal(pickVideoFile(pack, null, { season: 1, episode: 1 }), 0, 'E01 is not E10')
assert.equal(pickVideoFile(pack, null, { season: 2, episode: 2 }), 0, 'no match falls back to largest')
assert.equal(pickVideoFile([{ name: 'Show 1x02 HDTV.avi', length: 5, included: true }], null, { season: 1, episode: 2 }), 0)
// Once the engine has been narrowed to one file, that's the one to play back.
assert.equal(pickVideoFile(pack.map((f, i) => ({ ...f, included: i === 2 })), null), 2)

// --- Subtitles shipped inside the torrent -------------------------------------

// One video: every subtitle in the torrent can only belong to it, wherever the
// release chose to file them.
const withSubs = [
  { name: 'Sintel.2010.1080p.mkv', length: 2_100_000_000, included: true },
  { name: 'Sintel.2010.1080p.eng.srt', length: 60_000, included: true },
  { name: '2_Slovenian.srt', length: 55_000, included: true, components: ['Subs', '2_Slovenian.srt'] },
  { name: 'readme.txt', length: 30, included: true },
]
assert.deepEqual(pickSubtitleFiles(withSubs, 0), [1, 2])
assert.deepEqual(pickSubtitleFiles(files, 2), [], 'a release with none costs nothing')

// A season pack: only the episode being watched, however the subtitles are laid
// out — beside the video, or in a folder that names the episode itself.
const packSubs = [
  { name: 'Example.Show.S01E01.1080p.mkv', length: 3_000_000_000, included: true },
  { name: 'Example.Show.S01E02.1080p.mkv', length: 2_000_000_000, included: true },
  { name: 'Example.Show.S01E01.1080p.eng.srt', length: 50_000, included: true },
  { name: 'Example.Show.S01E02.1080p.eng.srt', length: 50_000, included: true },
  { name: '2_English.srt', length: 50_000, included: true, components: ['Subs', 'Example.Show.S01E02', '2_English.srt'] },
  { name: '2_English.srt', length: 50_000, included: true, components: ['Subs', 'Example.Show.S01E10', '2_English.srt'] },
]
assert.deepEqual(pickSubtitleFiles(packSubs, 1), [3, 4], 'E02 only, sibling and Subs/ alike')
assert.deepEqual(pickSubtitleFiles(packSubs, 0), [2], 'E01 is not E10 either')
// 1x02 spells the same episode, and a pack that numbers nothing falls back to
// the video's own name rather than pulling every language of every episode.
assert.deepEqual(pickSubtitleFiles([
  { name: 'Show 1x02 HDTV.avi', length: 5, included: true },
  { name: 'Show 1x01 HDTV.avi', length: 5, included: true },
  { name: 'Show 1x02 HDTV.srt', length: 5, included: true },
], 0), [2])
assert.deepEqual(pickSubtitleFiles([
  { name: 'Feature.CD1.avi', length: 5, included: true },
  { name: 'Feature.CD2.avi', length: 5, included: true },
  { name: 'Feature.CD2.srt', length: 5, included: true },
], 1), [2])

// --- Reading a release name ---------------------------------------------------
// A magnet arrives with nothing but its release name, and no catalogue has ever
// heard of "House.of.the.Dragon.S01.1080p.BluRay.x265[eztv.re]". Everything
// before the first technical detail is the title.
const rel = (s: string) => parseRelease(s)
assert.deepEqual(rel('House.of.the.Dragon.S01.1080p.BluRay.x265[eztv.re]'), {
  title: 'House of the Dragon',
  year: '',
  season: 1,
  episode: 0,
})
assert.deepEqual(rel('Obsession.2026.1080p.AMZN.WEB-DL.DDP5.1.H264.MP4-BEN.THE.MEN'), {
  title: 'Obsession',
  year: '2026',
  season: 0,
  episode: 0,
})
// A season pack names the season; only the file inside it names the episode.
assert.equal(rel('House.of.the.Dragon.S01E03.1080p.BluRay.x265.mkv').episode, 3)
assert.equal(rel('Show.Name.1x05.HDTV.XviD').episode, 5, 'the other way of spelling it')

// A year later than next year is part of the title, not a release year.
assert.deepEqual(rel('Blade.Runner.2049.2017.2160p.UHD.BluRay.x265'), {
  title: 'Blade Runner 2049',
  year: '2017',
  season: 0,
  episode: 0,
})
assert.equal(rel('Blade Runner 2049 1080p BluRay').title, 'Blade Runner 2049', 'even with no year to find')
// And a detail with nothing in front of it is the title, or these match anything.
assert.deepEqual(rel('1917.2019.1080p.BluRay.x264-SPARKS'), {
  title: '1917',
  year: '2019',
  season: 0,
  episode: 0,
})
assert.equal(rel('2012.2009.1080p.BluRay').title, '2012')

assert.equal(rel('[eztv] Some.Show.S02E10.720p.HDTV').title, 'Some Show', 'the tracker tag comes off')
assert.equal(rel('Obsession (2026) 1080p WEB-DL').year, '2026', 'a year in brackets is still a year')
assert.equal(rel('Obsession (2026) 1080p WEB-DL').title, 'Obsession', 'and the bracket does not survive it')
// A title that is already a title has nothing to cut, which is what makes this
// safe to run over everything rather than only over magnets.
assert.deepEqual(rel('Dune Part Two'), { title: 'Dune Part Two', year: '', season: 0, episode: 0 })
assert.deepEqual(rel(''), { title: '', year: '', season: 0, episode: 0 })

// --- Disk budget --------------------------------------------------------------

const GB = 1024 ** 3
// A 64 GB TV with 20 GB free: reserve 10% of the device, the rest is ours.
assert.equal(diskBudget({ free: 20 * GB, total: 64 * GB }, 0), 20 * GB - 6.4 * GB)
// Space the cache already holds is space it may reuse.
assert.equal(diskBudget({ free: 10 * GB, total: 64 * GB }, 10 * GB), 20 * GB - 6.4 * GB)
// Tiny device: the floor reserve wins, and a full disk yields no budget at all.
assert.equal(diskBudget({ free: 4 * GB, total: 8 * GB }, 0), 1 * GB)
assert.equal(diskBudget({ free: 1 * GB, total: 8 * GB }, 0), 0)
// Big disk: the reserve is capped, and the user's own cap beats the disk's room.
assert.equal(diskBudget({ free: 900 * GB, total: 2000 * GB }, 0), 880 * GB)
assert.equal(diskBudget({ free: 900 * GB, total: 2000 * GB }, 0, 50 * GB), 50 * GB)
// An unreadable disk must never produce a limit — that would delete films.
assert.equal(diskBudget(null, 0), Number.POSITIVE_INFINITY)
assert.equal(pickBest(parsed, diskBudget(null, 0))!.hash, 'bbb')
// …and a budget too small for the 2.1 GB copy drops a tier rather than failing.
assert.equal(pickBest(parsed, 1 * GB)!.hash, 'eee', 'only the 464 MB 720p fits')
assert.equal(pickBest(parsed, 100), null, 'nothing fits')

const cache = [1, 2, 3].map(id => ({
  id,
  info_hash: `h${id}`,
  stats: { progress_bytes: 5 * GB },
}))
const ages = { h1: 300, h2: 100, h3: 200 } // h2 is the least recently played
assert.equal(usedBytes(cache), 15 * GB)
assert.deepEqual(planEviction(cache, 20 * GB, null, ages), [], 'under budget: keep everything')
assert.deepEqual(planEviction(cache, 12 * GB, null, ages), [2], 'one is enough')
assert.deepEqual(planEviction(cache, 4 * GB, null, ages), [2, 3, 1], 'oldest first')
assert.deepEqual(planEviction(cache, 4 * GB, 2, ages), [3, 1], 'never what is playing')
assert.deepEqual(planEviction(cache, 4 * GB, 2, {}), [1, 3], 'no history: engine order')
assert.deepEqual(planEviction(cache, Number.POSITIVE_INFINITY, null, ages), [])

// --- Only download on Wi-Fi ---------------------------------------------------
// The rule is asymmetric on purpose: it stops anything running, but only ever
// starts what it stopped itself.

assert.deepEqual(
  planNetwork([1, 2, 3], null, [], true),
  { pause: [1, 2, 3], start: [], held: [1, 2, 3] },
  'metered: everything downloading stops',
)
assert.deepEqual(
  planNetwork([1, 2, 3], 2, [], true),
  { pause: [1, 3], start: [], held: [1, 3] },
  'except the film being watched — that download was asked for',
)
// A second poll sees the pauses have taken effect and must not forget them.
assert.deepEqual(planNetwork([], null, [1, 3], true).held, [1, 3], 'held survives the next poll')
assert.deepEqual(planNetwork([2], null, [1, 3], true).held, [1, 3, 2], 'and takes on a new one')
assert.deepEqual(
  planNetwork([], null, [1, 3], false),
  { pause: [], start: [1, 3], held: [] },
  'back on Wi-Fi: exactly what was held starts again',
)
// The one that matters: a torrent the user paused by hand was never held, so
// reaching Wi-Fi must not start it behind their back.
assert.deepEqual(planNetwork([], null, [], false), { pause: [], start: [], held: [] })
assert.deepEqual(planNetwork([9], null, [], false).start, [], 'nor is a running one touched')

// --- Seek previews ------------------------------------------------------------

assert.deepEqual(streamParts(`${ENGINE}/torrents/12/stream/3`), { id: 12, index: 3 })
assert.equal(streamParts('https://debrid.example/file.mkv'), null, 'a plain url is not a stream')

// Two 1000-byte files, 20 pieces of 100 bytes over the pair. The second one
// starts at byte 1000, so piece 10.
const map = { start: 1000, length: 1000, total: 2000, pieces: 20 }
/** Bitfield from a list of piece indexes, MSB of each byte first. */
function bits(...have: number[]) {
  const bf = new Uint8Array(3)
  for (const i of have)
    bf[i >> 3]! |= 0x80 >> (i & 7)
  return bf
}

const all = bits(...Array.from({ length: 20 }, (_, i) => i))
assert.ok(haveAt(map, all, 0), 'a complete torrent previews anywhere')
assert.ok(haveAt(map, all, 1))

// Half the file: pieces 10-14 cover 0 to 0.5 of it.
const half = bits(10, 11, 12, 13, 14)
assert.ok(haveAt(map, half, 0.1), 'well inside what is downloaded')
assert.ok(!haveAt(map, half, 0.6), 'past it')
// 0.4 lands on piece 14, whose neighbour 15 is missing — a decoder reads into it.
assert.ok(!haveAt(map, half, 0.4), 'the edge is not previewed, only the middle')
// But the file's own first piece is previewable without piece 9, which belongs
// to a file the engine may never have been asked to download.
assert.ok(haveAt(map, half, 0), 'the very start needs nothing before it')
assert.ok(haveAt(map, bits(15, 16, 17, 18, 19), 1), 'and the end nothing after it')

// A hole left by seeking forward is not "downloaded up to here".
assert.ok(!haveAt(map, bits(10, 11, 15, 16, 17, 18, 19), 0.35), 'a gap reads as missing')

// An empty bitfield says no rather than throwing.
assert.ok(!haveAt(map, new Uint8Array(0), 0.5))

// --- Seeding ------------------------------------------------------------------

const MBPS = 1024 ** 2
// Idle with nothing measured yet: probe unlimited, and never below the floor.
assert.equal(uploadLimit(0, false, true), null)
assert.equal(uploadLimit(0, false, false), 64 * 1024)
// A line that managed 4 MiB/s seeds at half that, a quarter of it while watching.
assert.equal(uploadLimit(4 * MBPS, false, false), 2 * MBPS)
assert.equal(uploadLimit(4 * MBPS, true, false), 1 * MBPS)
// Playback is never the probe: the stream is exactly what an open uplink hurts.
assert.equal(uploadLimit(4 * MBPS, true, true), 1 * MBPS)
// A slow line still seeds at the floor rather than at 12 KiB/s.
assert.equal(uploadLimit(100 * 1024, false, false), 64 * 1024)
// A limit set in settings wins over all of it — that is what "override" means.
assert.equal(uploadLimit(4 * MBPS, false, false, MBPS), MBPS)
assert.equal(uploadLimit(4 * MBPS, true, false, 8 * MBPS), 8 * MBPS, 'even where the app would back off')
assert.equal(uploadLimit(0, false, true, MBPS), MBPS, 'and it ends the probe')
assert.equal(uploadLimit(4 * MBPS, false, false, 0), 2 * MBPS, '0 means "work it out"')

// --- Sources ------------------------------------------------------------------
// The app ships with none and searches nothing until the user adds one, so the
// empty list has to fail loudly rather than look like "nothing found".

await assert.rejects(() => findReleases('tt0000001'), /No sources configured/)

// Whatever a user copies has to end up as a base we can append /stream/… to.
assert.equal(normalizeSource('  https://a.example/  '), 'https://a.example')
assert.equal(normalizeSource('https://a.example/manifest.json'), 'https://a.example')
assert.equal(normalizeSource('stremio://a.example/manifest.json'), 'https://a.example')
assert.equal(normalizeSource('STREMIO://a.example/Manifest.JSON'), 'https://a.example')
// The deep link the app registers for, which arrives in the same shape.
assert.equal(normalizeSource('ventic://a.example/manifest.json'), 'https://a.example')
assert.equal(normalizeSource('ventic://a.example/opt=x,y/manifest.json'), 'https://a.example/opt=x,y')
// A configured addon keeps its settings in the path — dropping them would
// silently hand back someone else's defaults.
assert.equal(normalizeSource('https://a.example/opt=x,y/manifest.json'), 'https://a.example/opt=x,y')
assert.equal(normalizeSource('https://a.example/opt=x/manifest.json?v=2'), 'https://a.example/opt=x')
assert.equal(normalizeSource('http://192.168.1.9:11470'), 'http://192.168.1.9:11470')
// A bare host is assumed to be https — that is what gets copied out of a forum
// post, and what a TV keyboard makes expensive to type in full.
assert.equal(normalizeSource('a.example'), 'https://a.example')
assert.equal(normalizeSource('a.example/opt=x/manifest.json'), 'https://a.example/opt=x')
// Not URLs.
assert.equal(normalizeSource(''), '')
assert.equal(normalizeSource('   '), '')
// A scheme that was given and isn't one we speak is an answer, not an omission.
assert.equal(normalizeSource('ftp://a.example'), '')
assert.equal(normalizeSource('https://'), '')

// Understanding a scheme is not enough to receive one. tauri-plugin-deep-link
// drops any URL whose scheme is missing from this list — on both the cold-start
// and the single-instance-forwarding path, and silently outside a debug build.
// `stremio` was absent for a while, which left the settings toggle claiming the
// scheme from the desktop while the app threw every link it got away.
const schemes: string[] = JSON.parse(
  await Bun.file('src-tauri/tauri.conf.json').text(),
).plugins['deep-link'].desktop.schemes
for (const scheme of ['ventic', 'stremio'])
  assert.ok(schemes.includes(scheme), `deep-link config must accept ${scheme}://`)

const realFetch = globalThis.fetch
/** Answers each URL from `replies`; anything unlisted is a source that's down. */
function stubFetch(replies: Record<string, unknown[]>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    const hit = Object.entries(replies).find(([base]) => url.startsWith(base))
    if (!hit)
      return new Response('nope', { status: 502 })
    return Response.json({ streams: hit[1] })
  }) as typeof fetch
}

setSources(['https://a.example/', ' https://b.example ', ''])
stubFetch({
  'https://a.example': [streams[1], streams[4]], // bbb, eee
  'https://b.example': [streams[1], streams[0]], // bbb again, plus aaa
})
const merged = await findReleases('tt0000001')
assert.deepEqual(merged.map(t => t.hash), ['bbb', 'eee', 'aaa'], 'merged, deduped, first source first')

// Two sources offering the same link are one result, the same way two offering
// the same info hash are — a link has no hash to dedupe on.
stubFetch({
  'https://a.example': [linkStreams[0]],
  'https://b.example': [linkStreams[0], linkStreams[2]],
})
assert.deepEqual(
  (await findReleases('tt0000001')).map(t => t.url),
  ['https://debrid.example/dl/abc/Sintel.mkv', 'https://host.example/sintel-720.mp4'],
)

// A source that's down costs its own results and nothing else.
stubFetch({ 'https://b.example': [streams[0]] })
assert.deepEqual((await findReleases('tt0000001')).map(t => t.hash), ['aaa'])

// Every source down is an error — silently returning nothing reads as "no such film".
stubFetch({})
await assert.rejects(() => findReleases('tt0000001'), /No source answered/)

// Trailing slashes must not survive into the request path.
let asked = ''
globalThis.fetch = (async (input: string | URL | Request) => {
  asked = String(input)
  return Response.json({ streams: [] })
}) as typeof fetch
setSources(['https://a.example/'])
await findReleases('tt0000001', 2, 5)
assert.equal(asked, 'https://a.example/stream/series/tt0000001:2:5.json')

// --- Playing what is already downloaded ---------------------------------------
// A film on the disk must play with no sources, no peers and no network at all:
// searching again is both slow and how you end up with a second copy of it.

const PACK = [
  { name: 'readme.txt', length: 10, included: true },
  { name: 'Sintel.2010.1080p.mkv', length: 2_000_000_000, included: true },
]

/** How much of file 1 the engine holds, and whether it holds the torrent. */
const engine = { have: 2_000_000_000, held: true }
let requests: string[] = []

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input)
  requests.push(url)
  // Deliberately upper-case where the caller remembers it lower-case: librqbit
  // and the addons do not agree on which, and a case-sensitive compare here
  // would silently re-download everything.
  const listed = { id: 7, info_hash: 'BBB', name: 'pack', output_folder: '/x', stats: { file_progress: [10, engine.have] } }
  if (url.startsWith(`${ENGINE}/torrents?with_stats`))
    return Response.json({ torrents: engine.held ? [listed] : [] })
  if (url === `${ENGINE}/torrents/7`)
    return Response.json({ ...listed, files: PACK })
  if (url.startsWith(`${ENGINE}/torrents?overwrite`))
    return Response.json({ id: 7, details: { name: 'pack', info_hash: 'bbb', files: PACK } })
  if (url.startsWith(ENGINE))
    return Response.json({})
  return Response.json({ streams: [streams[1]] }) // a source, if one is asked
}) as typeof fetch

setSources(['https://a.example'])
const cached = { hash: 'bbb', file: 1 }

const disk = await startTorrent({ imdbId: 'tt0000001', cached })
assert.equal(disk.id, 7)
assert.equal(disk.index, 1, 'the file it was played from, not the biggest one')
// The engine's own spelling, not the caller's: what comes back here is filed as
// the title's offline copy, and the store prunes that list by comparing it to
// the hashes the engine lists (see `prune`).
assert.equal(disk.hash, 'BBB')
assert.ok(!requests.some(u => u.startsWith('https://a.example')), 'nothing on disk is ever searched for')
assert.ok(!requests.some(u => u.includes('overwrite')), 'nor re-added to the engine')
assert.ok(requests.includes(`${ENGINE}/torrents/7`), 'it asked the engine what it actually holds')

// The downloads page plays by magnet and never by title, so nothing is filed
// under a key and `cached` is empty — the hash in the magnet is the only clue
// that this is the copy sitting on the disk. Re-adding it made librqbit re-open
// a torrent it was already serving, which is a finished film sitting through
// "fetching metadata" with every byte of it downloaded.
requests = []
const byMagnet = await startTorrent({ magnet: 'magnet:?xt=urn:btih:bbb&dn=pack&tr=udp%3A%2F%2Ftracker', fileIndex: 1 })
assert.equal(byMagnet.id, 7)
assert.equal(byMagnet.index, 1)
assert.ok(!requests.some(u => u.includes('overwrite')), 'a hash the engine holds is never re-added')

// Same again with nobody naming a file: the magnet says which torrent, and the
// pack's own contents say which file inside it.
requests = []
assert.equal((await startTorrent({ magnet: 'magnet:?xt=urn:btih:BBB' })).index, 1)
assert.ok(!requests.some(u => u.includes('overwrite')), 'and the case of the hash is not what decides it')

// Half-downloaded: the same release still beats searching for another one, and
// the engine picks up where it left off.
engine.have = 500_000_000
requests = []
const resumed = await startTorrent({ imdbId: 'tt0000001', cached })
assert.equal(resumed.id, 7)
assert.equal(resumed.index, 1)
assert.ok(!requests.some(u => u.startsWith('https://a.example')), 'the release is already decided')
assert.ok(requests.some(u => u.includes('overwrite=true')), 'handed back to the engine to finish')

// Evicted since: the bytes are gone, so the sources are worth asking again —
// re-adding a hash nobody seeds any more would just hang.
engine.held = false
requests = []
const refound = await startTorrent({ imdbId: 'tt0000001', cached })
assert.equal(refound.hash, 'bbb')
assert.ok(requests.some(u => u.startsWith('https://a.example')), 'a copy that is gone is searched for again')

// --- A file the user already had ----------------------------------------------
// The whole of "play my own films": no folder scan, no filename parsing and no
// matching, because the path was handed in by someone who had already found the
// title. From there it is a stream like any other — but one that costs the
// engine, the sources, the disk budget and TMDB nothing at all.

engine.held = true
engine.have = 2_000_000_000
requests = []
const own = await startTorrent({ imdbId: 'tt0000001', local: '/films/The Searchers (1956).mkv', cached })
assert.equal(own.url, '/films/The Searchers (1956).mkv')
assert.equal(own.id, -1)
assert.equal(own.hash, '', 'nothing lands on disk, so there is no offline copy to file')
assert.equal(requests.length, 0, 'nothing is searched for, asked of the engine, or looked up')

// Attaching a file is a standing decision about the title; picking a release is
// a decision about this one play, so that still wins.
requests = []
assert.equal(
  (await startTorrent({ magnet: 'magnet:?xt=urn:btih:bbb', local: '/films/ignored.mkv' })).index,
  1,
  'a hand-picked release beats the attached file',
)

// --- Adopting a download nobody filed under a title ---------------------------
// A pasted magnet, or anything downloaded before the title had a cached entry,
// is still the copy that should play — and with no sources it is the only one.

engine.held = true
engine.have = 2_000_000_000
const HELD = { id: 7, info_hash: 'BBB', name: 'Sintel.2010.1080p.BluRay.x264', output_folder: '/x', stats: { file_progress: [10, engine.have] } }

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input)
  requests.push(url)
  if (url.startsWith(`${ENGINE}/torrents?with_stats`))
    return Response.json({ torrents: engine.held ? [HELD] : [] })
  if (url === `${ENGINE}/torrents/7`)
    return Response.json({ ...HELD, files: PACK })
  if (url.startsWith(`${ENGINE}/torrents?overwrite`))
    return Response.json({ id: 7, details: { name: HELD.name, info_hash: 'bbb', files: PACK } })
  if (url.startsWith(ENGINE))
    return Response.json({})
  return Response.json({ streams: [streams[1]] })
}) as typeof fetch

requests = []
const adopted = await startTorrent({ imdbId: 'tt0000001', named: () => ({ title: 'Sintel', year: '2010' }) })
assert.equal(adopted.id, 7, 'the copy already on the disk')
assert.ok(!requests.some(u => u.startsWith('https://a.example')), 'a held copy is never searched for')

// A link the picker chose goes straight to the player: the engine never hears
// about it, so there is no metadata round trip, nothing to evict later, and
// nothing filed as this title's offline copy. It outranks the copy on disk for
// the same reason a magnet does — someone picked it by hand.
requests = []
const direct = await startTorrent({ url: 'https://debrid.example/dl/abc/Sintel.mkv', cached })
assert.equal(direct.url, 'https://debrid.example/dl/abc/Sintel.mkv')
assert.equal(direct.id, -1)
assert.equal(direct.hash, '')
assert.deepEqual(requests, [], 'the engine was not asked anything at all')

// Strict on purpose: a near-miss name would play the wrong film, which is worse
// than the search it saves.
requests = []
await assert.rejects(
  startTorrent({ imdbId: null, named: () => ({ title: 'Sintels', year: '2010' }) }),
  'a longer title is a different film',
)
await assert.rejects(
  startTorrent({ imdbId: null, named: () => ({ title: 'Sintel', year: '2016' }) }),
  'a remake is a different film',
)
await assert.rejects(
  startTorrent({ imdbId: null, named: () => ({ title: 'Sin', year: '2010' }) }),
  'short titles match far too much to adopt on a name',
)
// A pack only counts for an episode it actually holds — otherwise pickVideoFile
// falls back to the largest file and quietly plays the wrong one.
await assert.rejects(
  startTorrent({ imdbId: null, named: () => ({ title: 'Sintel' }), season: 2, episode: 5 }),
  'the episode is not in this pack',
)

// The title as TMDB spells it is read late, so a lookup still in flight when
// playback starts does not cost the adoption.
requests = []
let title: { title: string } | null = null
const promise = startTorrent({
  imdbId: async () => {
    title = { title: 'Sintel' }
    return 'tt0000001'
  },
  named: () => title,
})
assert.equal((await promise).id, 7, 'the name arrived with the lookup, and still adopted')
assert.ok(!requests.some(u => u.startsWith('https://a.example')), 'and the sources were never asked')

globalThis.fetch = realFetch
setSources([])

// `--live <source-url> <imdb-id>`: no source is baked in, so both are required.
const live = process.argv.indexOf('--live')
if (live !== -1) {
  const [base, imdbId] = process.argv.slice(live + 1)
  assert.ok(base && imdbId, 'usage: --live <source-url> <imdb-id>')
  setSources([base])
  const found = await findReleases(imdbId)
  const best = pickBest(found)
  console.log(`live: ${found.length} results, best = ${best?.quality} ${best?.size} ${best?.seeders} seeders (${best?.source})`)
  assert.ok(best, 'the source returned something playable')
}

console.log('torrents: ok')
