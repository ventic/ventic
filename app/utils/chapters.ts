/**
 * A file's chapters, as mpv's `chapter-list` reports them, and which of them are
 * the parts nobody sits through twice.
 *
 * Only mpv reads chapters: media3 exposes none from a Matroska file and a
 * `<video>` has no such idea, so on Android and in a browser the list is empty
 * and nothing here ever shows. `bun run check:player` holds the name matching.
 */
export interface Chapter {
  title: string
  /** Seconds into the file. */
  time: number
}

export type Skippable = 'intro' | 'credits'

/**
 * The names releases give these parts. Anime is the most consistent about it
 * (Opening/OP, Ending/ED, often numbered), a TV rip less so (Intro, Recap,
 * Credits) — and a chapter merely *called* "Chapter 3" is never a guess.
 * Whole names only: "Opening Night" is a scene, not a title sequence.
 */
const INTRO = /^(?:intro(?:duction)?|op(?:ening)?(?: ?\d+)?(?: (?:credits|titles|theme|song|sequence))?|recap|previously(?: on\b.*)?|title sequence|main titles?)$/i
const CREDITS = /^(?:ed(?: ?\d+)?|ending(?: ?\d+)?(?: (?:credits|titles|theme|song))?|end(?:ing)? credits|closing(?: credits| titles)?|credits|outro)$/i

/**
 * Which kind of skippable part a chapter is, from its name, or null. A leading
 * number is dropped first, because plenty of releases write "01. Opening" or
 * "02 - Part A".
 */
export function skippable(title: string): Skippable | null {
  const name = title.trim().replace(/^\d+\s*[.:)\-–]?\s*/, '').trim()
  if (INTRO.test(name))
    return 'intro'
  if (CREDITS.test(name))
    return 'credits'
  return null
}

/** mpv's `chapter-list`, read defensively: an entry without a time is no chapter. */
export function readChapters(raw: unknown): Chapter[] {
  if (!Array.isArray(raw))
    return []
  return raw
    .filter((c): c is { title?: unknown, time: number } => typeof c?.time === 'number' && Number.isFinite(c.time))
    .map(c => ({ title: typeof c.title === 'string' ? c.title : '', time: c.time }))
    .sort((a, b) => a.time - b.time)
}

/**
 * The chapter playing at `t`, with where it ends — the next one's start, or the
 * end of the file for the last — and whether it is the last.
 */
export function chapterAt(chapters: Chapter[], t: number, duration: number) {
  let index = -1
  for (let i = 0; i < chapters.length && chapters[i]!.time <= t; i++)
    index = i
  if (index < 0)
    return null
  const chapter = chapters[index]!
  const next = chapters[index + 1]
  return { ...chapter, index, end: next?.time ?? duration, last: !next }
}
