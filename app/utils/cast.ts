/**
 * Casting — putting what this device is playing on another Ventic on the same
 * network.
 *
 * The thing that travels is a **URL**, never a torrent, so the receiving device
 * plays it down the path a debrid link or a live channel already takes
 * (`?url=` in pages/watch.vue). Nothing about playback, progress, subtitles or
 * the library needed a second implementation, and the film is not fetched
 * twice — which matters most on the device most likely to be receiving one: a
 * TV box has no room for a second copy of anything.
 *
 * Where those bytes come from is `cast_share` in src-tauri/src/cast.rs: a
 * second, **read-only** copy of the torrent engine's HTTP API bound to the LAN.
 * The engine's real API stays on 127.0.0.1 — it can add and delete torrents.
 *
 * Nothing here leaves the local network and there is no server in the middle,
 * which is the same answer the library gives to syncing. Devices are found by
 * asking every address on this subnet whether it is a Ventic; acting on what
 * one says needs the pairing code shown on its own screen.
 */
import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { ENGINE } from './torrents'

/** Where a device listens for play commands — `RECEIVER_PORT` in cast.rs. */
export const CAST_PORT = 3232

/**
 * Where this device serves the film from while a cast lasts — `MIRROR_PORT` in
 * cast.rs. Named here because it is the port a firewall has to let *in*, and
 * that is what the failure below has to tell people.
 */
export const MIRROR_PORT = 3231

/** A Ventic that answered a probe. */
export interface CastDevice {
  /** What it calls itself, as the other device's settings screen named it. */
  name: string
  address: string
}

/** A play command, as `Play` in cast.rs deserialises it. */
export interface CastPlay {
  url: string
  /** 'movie' | 'tv', or '' for something with no TMDB identity at all. */
  kind: string
  id: string
  season: number
  episode: number
  title: string
  /** Seconds to resume at — where this device had got to. */
  position: number
}

/**
 * The stream URL to hand the other device, or null when there is nothing it
 * could open.
 *
 * The engine's own address is the loopback one, which on the receiving device
 * means *its* engine — so it has to be swapped for the mirror's before it is
 * sent anywhere. Everything else is already a URL that any device can fetch.
 */
export function castUrl(src: string, base: string): string | null {
  if (src.startsWith(ENGINE))
    return base + src.slice(ENGINE.length)

  // A debrid link or a live channel: the other device fetches it from wherever
  // this one would have, and needs nothing from us but the address.
  if (/^https?:\/\//i.test(src))
    return src

  // A file on this machine's own disk (see LocalFileButton). Nothing on the
  // other device can open a path that only exists here, and serving it would be
  // a second file server with a second set of rules about what may leave.
  return null
}

/**
 * Is there anything here another device could be handed? Asked before the
 * button is drawn, so a film opened from this machine's own disk offers no
 * cast rather than failing at the last step.
 */
export function castable(src: string) {
  return src.startsWith(ENGINE) || /^https?:\/\//i.test(src)
}

/**
 * Every address on this device's subnet, itself left out.
 *
 * ponytail: a /24, which is what a home network is. A /16 is 65k probes and
 * would want mDNS instead — the address field on the dialog covers it until
 * somebody actually has one.
 */
export function subnet(ip: string): string[] {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255))
    return []

  const prefix = parts.slice(0, 3).join('.')
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).filter(address => address !== ip)
}

/** A fresh pairing code. Four digits: it is read off a television. */
export function newCode() {
  return String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
}

/**
 * The query a received command turns into. The receiving device's player is
 * driven entirely by the route, so this is the whole of "act on a cast".
 */
export function castRoute(play: CastPlay): Record<string, string> {
  const query: Record<string, string> = { url: play.url }
  if (play.kind)
    query.type = play.kind
  if (play.id)
    query.id = play.id
  if (play.season)
    query.s = String(play.season)
  if (play.episode)
    query.e = String(play.episode)
  if (play.title)
    query.title = play.title
  // Under a second is the start of the film, and `t=0` would only take a seek
  // the player was not going to make anyway.
  if (play.position >= 1)
    query.t = String(Math.floor(play.position))
  return query
}

// --- Talking to the other device ----------------------------------------------
// Through tauri-plugin-http, not the webview's fetch: another device on the LAN
// sends no `Access-Control-Allow-Origin` either (see utils/iptv.ts).

/** Is there a Ventic at this address? Its name if so, null for anything else. */
export async function probeDevice(address: string, timeout = 700): Promise<CastDevice | null> {
  try {
    const res = await tauriFetch(`http://${address}:${CAST_PORT}/ventic`, {
      connectTimeout: timeout,
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok)
      return null

    // Anything at all can be listening on a port, and a printer that answers
    // with 200 and a page of HTML is not something to offer as a television.
    const body = await res.json() as { app?: string, name?: string }
    return body?.app === 'ventic' ? { address, name: body.name || address } : null
  }
  catch {
    return null
  }
}

/**
 * Ask every address on the subnet, reporting each Ventic as it answers rather
 * than at the end — the first one usually replies in well under a second, and a
 * list that fills in is the difference between "searching" and "broken".
 */
export async function findDevices(self: string, onFound: (device: CastDevice) => void, signal?: AbortSignal) {
  const addresses = subnet(self)
  let next = 0

  // ponytail: 32 at a time. A phone will queue all 254 happily enough and then
  // time every one of them out together, which reads as finding nothing.
  const workers = Array.from({ length: Math.min(32, addresses.length) }, async () => {
    while (next < addresses.length && !signal?.aborted) {
      const device = await probeDevice(addresses[next++]!)
      if (device && !signal?.aborted)
        onFound(device)
    }
  })
  await Promise.all(workers)
}

/** Is this a URL this device is serving, rather than one anybody can fetch? */
export function mirrored(url: string) {
  try {
    return new URL(url).port === String(MIRROR_PORT)
  }
  catch {
    return false
  }
}

/** Why a cast didn't happen, and the one-line fix where there is one. */
export interface CastProblem {
  message: string
  /**
   * A command to paste, for the failure that has one. Only the firewall case
   * does, and only on Linux — see `cast_firewall_hint` in cast.rs for why that
   * is the platform with a hole to plug rather than a dialog to click.
   */
  command?: string
}

/** Null when the other device took it, otherwise why it didn't. */
export async function sendPlay(device: CastDevice, code: string, play: CastPlay): Promise<CastProblem | null> {
  try {
    const res = await tauriFetch(`http://${device.address}:${CAST_PORT}/ventic/play`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...play, code }),
      connectTimeout: 4000,
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 403)
      return { message: $t('That code doesn\'t match the one on the other device.') }

    // The other device took the command and then couldn't open the film (see
    // `reachable` in cast.rs). When the film is ours to serve, that is nearly
    // always this machine's own firewall: 3231 is an inbound port here, and a
    // dropped connection is the one failure the sending device cannot see for
    // itself. Said here, on the screen belonging to the machine that has the
    // firewall, rather than left to a television across the room — and said
    // with the command, because a rule nobody can remember the syntax of is a
    // rule nobody adds.
    if (res.status === 502) {
      return mirrored(play.url)
        ? {
            message: $t('{device} couldn\'t reach this device — a firewall here is blocking port {port}.', { device: device.name, port: MIRROR_PORT }),
            command: await firewallHint(),
          }
        : { message: $t('{device} couldn\'t open that link. It may have expired, or that device may have no connection of its own.', { device: device.name }) }
    }
    return res.ok ? null : { message: $t('The other device refused the film.') }
  }
  catch {
    return { message: $t('Couldn\'t reach that device.') }
  }
}

/** Take it back: tell the other device to leave the player. */
export async function sendStop(device: CastDevice, code: string): Promise<CastProblem | null> {
  try {
    const res = await tauriFetch(`http://${device.address}:${CAST_PORT}/ventic/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      connectTimeout: 3000,
      signal: AbortSignal.timeout(5000),
    })
    if (res.status === 403)
      return { message: $t('That code doesn\'t match the one on the other device.') }
    return res.ok ? null : { message: $t('{device} didn\'t stop. Stop the film there yourself.', { device: device.name }) }
  }
  catch {
    return { message: $t('{device} didn\'t answer. Stop the film there yourself.', { device: device.name }) }
  }
}

/**
 * Everything about the device being cast to, as it is remembered between
 * screens — the address to reach it at and the code it answers to.
 */
export interface CastTarget extends CastDevice {
  code: string
}

/**
 * Take the film back: stop the other device, then stop serving it to the
 * network.
 *
 * One function because there are two places to press Stop — the player, and
 * Settings → Network* once the player has been left — and a Stop that only did
 * half the job from one of them is the bug this replaced. Leaving the player is
 * the ordinary way to use a cast (the whole point is putting the phone down),
 * so the durable copy of who is playing it lives in settings, not on the page.
 *
 * Stops sharing whatever the other device said, including nothing at all: the
 * mirror going down is what ends the film for a television that never heard,
 * and leaving a port open because a switched-off TV didn't answer is worse than
 * either.
 */
export async function stopCast(target: CastTarget | null): Promise<CastProblem | null> {
  const problem = target ? await sendStop(target, target.code) : null
  await shareEngine(false).catch(() => {})
  return problem
}

// --- This device --------------------------------------------------------------

/** This device's own LAN address, or '' where it has none. */
export async function castAddress(): Promise<string> {
  return await invoke<string | null>('cast_address').catch(() => null) ?? ''
}

/**
 * Start or stop serving this device's engine, read-only, to the network.
 * Returns the base URL another device streams from, '' once stopped.
 *
 * On for as long as a cast lasts and no longer — it has to outlive the player
 * page (the whole point is putting the phone down), but leaving it up for the
 * session would keep the film readable by the network long after it stopped
 * being played, and on Android would hold a wake lock with it.
 */
export async function shareEngine(enable: boolean): Promise<string> {
  return await invoke<string | null>('cast_share', { enable }) ?? ''
}

/**
 * A ready-to-paste command that opens the mirror port on this machine, or ''
 * where the platform doesn't need one. Only asked for once a cast has actually
 * been refused, so nothing goes looking for a firewall that isn't in the way.
 */
export async function firewallHint(): Promise<string> {
  return await invoke<string | null>('cast_firewall_hint').catch(() => null) ?? ''
}

/** Is this device serving its engine to the network right now? */
export async function sharingEngine(): Promise<boolean> {
  return await invoke<boolean>('cast_sharing').catch(() => false)
}

/** Start or stop answering play commands from other devices. */
export async function receiveCasts(enable: boolean, name: string, code: string): Promise<void> {
  await invoke('cast_receive', { enable, name, code })
}
