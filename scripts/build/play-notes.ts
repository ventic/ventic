/**
 * Turn a GitHub release body into Google Play's "What's new" text.
 *
 *   printf '%s' "$BODY" | bun scripts/build/play-notes.ts > whatsnew/whatsnew-en-US
 *
 * Play takes 500 characters of plain text, and a release here is a page of
 * Markdown with headings. The paragraph under the title is already the summary
 * — the notes are written that way — so that is what goes, with the Markdown
 * taken out. The "Code signing policy" line the release workflow opens every
 * draft with is a requirement of the release *page*, not news, so it is dropped.
 */

export const LIMIT = 500
const FALLBACK = 'Bug fixes and improvements.'

export function playNotes(body: string): string {
  const paragraph = body
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map(p => p.split('\n').filter(l => !/^\s*#/.test(l) && !/code signing policy/i.test(l)).join(' '))
    .map(p => p
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*`]/g, '')
      .replace(/^\s*(?:[-+>]|\d+\.)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim())
    .find(Boolean)
  if (!paragraph)
    return FALLBACK
  if (paragraph.length <= LIMIT)
    return paragraph
  // Cut on a sentence if one ends late enough to keep most of it, else on a word.
  const head = paragraph.slice(0, LIMIT)
  const sentence = head.lastIndexOf('. ')
  if (sentence > LIMIT / 2)
    return head.slice(0, sentence + 1)
  return `${head.slice(0, head.lastIndexOf(' ', LIMIT - 1))}…`
}

if (import.meta.main)
  process.stdout.write(playNotes(await Bun.stdin.text()))
