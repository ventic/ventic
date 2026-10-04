/**
 * Profiles: several people on one install, each with their own library and
 * preferences — and, for a child, a ceiling on what plays and for how long.
 *
 * **A profile is a suffix on a key.** Every per-person localStorage key is read
 * through `scoped()`, which answers `ventic.progress` for the default profile and
 * `ventic.progress@k3j2a9` for any other. So the library every install already
 * has *is* the default profile: nothing is migrated, nothing moves, and an older
 * build still finds it where it always was. What is not scoped is the machine's
 * — the sources, the engine, the download folder, the cast receiver — and stays
 * shared by whoever is holding the remote.
 *
 * Switching is a reload, for the reason a restore is one: every store reads its
 * keys once, at setup. So the profile a page was built for is fixed for the
 * page's lifetime, and `ACTIVE` is read once.
 *
 * Pure functions, so `bun run check:profiles` holds the rules.
 */
import type { MediaType } from './tmdb'

export const DEFAULT_PROFILE = 'default'

/** The profile this page was loaded for, read before any store exists to ask. */
export const ACTIVE = (() => {
  try {
    return localStorage.getItem('ventic.profile') || DEFAULT_PROFILE
  }
  catch {
    return DEFAULT_PROFILE // a check script, or a webview with storage switched off
  }
})()

export function scoped(key: string, id = ACTIVE) {
  return id === DEFAULT_PROFILE ? key : `${key}@${id}`
}

/** `ventic.progress@k3j2a9` -> ['ventic.progress', 'k3j2a9']; a bare key is the default profile's. */
export function unscope(key: string): [string, string] {
  const at = key.indexOf('@')
  return at < 0 ? [key, DEFAULT_PROFILE] : [key.slice(0, at), key.slice(at + 1)]
}

/** The age bands every streaming service already sorts children into. */
export type Level = 'little' | 'kids' | 'teens'

export interface Limits {
  /** The most a title may be rated — one of `LEVELS`. */
  level: Level
  /** Minutes of playback a day, 0 for no limit. */
  minutes: number
}

export interface Profile {
  /** Random and never reused, or `DEFAULT_PROFILE` for the one that owns the bare keys. */
  id: string
  /** Empty only for the default profile, which then reads as "Default". */
  name: string
  colour: string
  /**
   * Last changed, ms. Sync merges the registry entry by entry on this, as it
   * does progress — and a deleted profile stays behind as `gone`, which is what
   * stops another screen handing it straight back.
   */
  at: number
  gone?: boolean
  /** Parental controls; absent means none. */
  kids?: Limits
  /** Browse lists keep the erotic anime TMDB doesn't flag as adult. Never for a child. */
  nsfw?: boolean
}

/** Bright enough to carry a white initial across a room. */
export const COLOURS = ['#1e88e5', '#e53935', '#8e24aa', '#00897b', '#f4511e', '#3949ab', '#43a047', '#6d4c41']

export function profileName(p: Pick<Profile, 'name'>) {
  return p.name || $t('Default')
}

export function newProfileId() {
  return Math.random().toString(36).slice(2, 10)
}

/** Everyone, the default first and the rest by name, the deleted left out. */
export function listProfiles(stored: Record<string, Profile>): Profile[] {
  const others = Object.values(stored)
    .filter(p => p.id !== DEFAULT_PROFILE && !p.gone)
    .sort((a, b) => a.name.localeCompare(b.name))
  return [stored[DEFAULT_PROFILE] ?? { id: DEFAULT_PROFILE, name: '', colour: COLOURS[0]!, at: 0 }, ...others]
}

// --- What a child may watch ----------------------------------------------------

/**
 * TMDB's US scales, mildest first — the order its `certification.lte` filter
 * walks. "NR" is left out on purpose: TMDB files it *below* the mildest rating,
 * so a ceiling on its own lets every unrated title through.
 */
const SCALE: Record<MediaType, string[]> = {
  movie: ['G', 'PG', 'PG-13', 'R', 'NC-17'],
  tv: ['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'],
}

// `title` is a function for the same reason SECTIONS' is — see the settings store.
export const LEVELS: { value: Level, title: () => string, movie: string, tv: string }[] = [
  { value: 'little', title: () => $t('Little kids'), movie: 'G', tv: 'TV-G' },
  { value: 'kids', title: () => $t('Older kids'), movie: 'PG', tv: 'TV-PG' },
  { value: 'teens', title: () => $t('Teens'), movie: 'PG-13', tv: 'TV-14' },
]

/** An unknown level is the strictest one, never none. */
export function levelOf(limits: Limits) {
  return LEVELS.find(l => l.value === limits.level) ?? LEVELS[0]!
}

/**
 * May a profile with these limits play a title rated `rating`? Unrated is a no:
 * "nobody rated it" is not "it is fine", and a grown-up's PIN unlocks it in a
 * press.
 */
export function allowed(type: MediaType, rating: string, limits?: Limits) {
  if (!limits)
    return true
  const at = SCALE[type].indexOf(rating)
  return at >= 0 && at <= SCALE[type].indexOf(levelOf(limits)[type])
}

/**
 * TMDB keywords on the erotic anime it does not mark `adult`: hentai, erotic,
 * softcore, erotica, animated porn. Measured 2026-10-04, the most popular anime
 * on TMDB was one of these shorts, and the TV page's first pages carried two.
 * `ecchi` is deliberately not here — it is on Fairy Tail and Food Wars. Piped,
 * so a title carrying any one of them is out.
 */
export const NSFW_KEYWORDS = [198385, 256466, 155477, 325693, 378816].join('|')

/**
 * What a discover request adds for this profile: a child's ceiling — from the
 * mildest rating up, which is what keeps "NR" out — and the NSFW keywords for
 * anyone who hasn't asked to see them. Those are TV only: a film TMDB calls
 * erotic and not adult is an R, and a Movies page hiding R films from grown-ups
 * would be a different app.
 */
export function discoverParams(type: MediaType, profile: Pick<Profile, 'kids' | 'nsfw'>): Record<string, string> {
  return {
    ...(profile.kids
      ? { 'certification_country': 'US', 'certification.gte': SCALE[type][0]!, 'certification.lte': levelOf(profile.kids)[type] }
      : {}),
    ...(type === 'tv' && (profile.kids || !profile.nsfw) ? { without_keywords: NSFW_KEYWORDS } : {}),
  }
}

// --- The PIN -------------------------------------------------------------------

/**
 * Whether going from `from` to `to` takes the PIN. The picker, the menu and a
 * cold start all ask here:
 *
 * - Nothing is guarded in a house with no child profile.
 * - A child's profile is left only with the PIN, for a sibling's too — or the
 *   one whose time is up just becomes the one whose time isn't.
 * - A grown-up's is entered only with it, which is what makes the rule above
 *   mean anything: a child could otherwise just pick it.
 *
 * `chosen` is whether anybody got into `from` this session. At a cold start
 * nobody has, so even the profile that was open last asks.
 */
export function needsPin(to: Profile, from: Profile, all: Profile[], chosen: boolean) {
  if (!all.some(p => p.kids))
    return false
  if (chosen && to.id === from.id)
    return false
  return !to.kids || (chosen && !!from.kids)
}

/**
 * Salted and hashed. Four digits are no secret from anyone holding the file —
 * the threat is a child with a remote, not a cracker — but a backup is a JSON
 * file in the documents folder, and "1234" in it would be the PIN for anybody
 * who opened it. The salt is what stops the hash of "1234" being one search away.
 */
export async function hashPin(pin: string, salt = newProfileId()) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`))
  return `${salt}:${[...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')}`
}

export async function checkPin(pin: string, stored: string) {
  return !!stored && stored === await hashPin(pin, stored.split(':')[0])
}

// --- Watch time ----------------------------------------------------------------

export interface Usage {
  /** `toDateString()` of the day these count, so local midnight starts afresh. */
  day: string
  seconds: number
  /** What a grown-up added today. */
  extra: number
}

function today(usage: Usage, now: number): Usage {
  const day = new Date(now).toDateString()
  return usage.day === day ? usage : { day, seconds: 0, extra: 0 }
}

/** Seconds of today's allowance left; Infinity with no limit. */
export function secondsLeft(usage: Usage, minutes: number, now = Date.now()) {
  if (!minutes)
    return Infinity
  const t = today(usage, now)
  return minutes * 60 + t.extra - t.seconds
}

export function spendTime(usage: Usage, seconds: number, now = Date.now()): Usage {
  const t = today(usage, now)
  return { ...t, seconds: t.seconds + seconds }
}

export function addTime(usage: Usage, seconds: number, now = Date.now()): Usage {
  const t = today(usage, now)
  return { ...t, extra: t.extra + seconds }
}

/** `fn` over `items`, `limit` at a time — TMDB starts refusing past about forty a second. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }))
  return out
}
