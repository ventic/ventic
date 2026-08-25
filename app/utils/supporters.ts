import { REPO } from './updates'

/**
 * Who paid for this, and how far off the running costs are.
 *
 * Ko-fi has no read API — no key to ask for, no paid tier that adds one. The
 * only thing it will tell a program is a webhook POST at the moment a donation
 * lands, which needs a server to receive it, and Ventic has no server. So the
 * list is a file in the repository, kept by hand from the Ko-fi dashboard and
 * read over https like the release check is (`updates.ts`):
 * raw.githubusercontent answers with `Access-Control-Allow-Origin: *`, which a
 * `tauri://` origin needs.
 *
 * Editing `supporters.json` on GitHub is the whole publish step — thanking
 * somebody doesn't wait for a release. It is cached for a few minutes at the
 * CDN, and the page asks once per visit.
 */
export const KOFI_URL = 'https://ko-fi.com/ventictv'

/** `main`, not a tag: the file is the live list, not the one this build shipped. */
export const SUPPORTERS_URL = `https://raw.githubusercontent.com/${REPO}/main/supporters.json`

export interface Supporter {
  name: string
  /** In `currency`. Optional — Ko-fi lets a donation be private about it. */
  amount?: number
  /** Free text: `2026-08`, `since June`, whatever reads right beside the name. */
  at?: string
}

export interface Supporters {
  goal: number
  raised: number
  /** ISO 4217, for `Intl.NumberFormat`. */
  currency: string
  monthly: Supporter[]
  once: Supporter[]
}

/**
 * Forgiving on purpose: this file is hand-edited between releases, and a
 * trailing comma or a half-written entry must not take the settings page down
 * with it. Anything unreadable is simply not shown.
 */
export function parseSupporters(data: unknown): Supporters {
  const o = (data ?? {}) as Record<string, unknown>
  const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0

  const people = (v: unknown): Supporter[] => (Array.isArray(v) ? v : [])
    .map(s => (s ?? {}) as Record<string, unknown>)
    .filter(s => typeof s.name === 'string' && s.name.trim())
    .map(s => ({
      name: (s.name as string).trim(),
      amount: num(s.amount) || undefined,
      at: typeof s.at === 'string' && s.at.trim() ? s.at.trim() : undefined,
    }))

  return {
    goal: num(o.goal),
    raised: num(o.raised),
    currency: typeof o.currency === 'string' && o.currency.length === 3 ? o.currency : 'EUR',
    monthly: people(o.monthly),
    once: people(o.once),
  }
}

export async function fetchSupporters(): Promise<Supporters> {
  const res = await fetch(SUPPORTERS_URL, { headers: { accept: 'application/json' } })
  if (!res.ok)
    throw new Error(`${res.status}`)
  return parseSupporters(await res.json())
}
