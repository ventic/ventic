// Self-check for Google Play's "What's new": `bun scripts/check-play-notes.ts`.
//
// Play refuses release notes over 500 characters, and it refuses them at the
// end of an upload that has already run a whole build — so the length is held
// here, against the shape real release notes have.
import assert from 'node:assert'
import { LIMIT, playNotes } from './build/play-notes'

// The top of the v0.7.3 release, verbatim, behind the line the workflow adds.
const RELEASE = `[Code signing policy](https://github.com/ventic/ventic#code-signing-policy)

## Ventic 0.7.3

Setting this up no longer means typing a web address with a remote: point a
phone's camera at a code on the screen and type it there instead. A release
that is never going to arrive now says so while you are waiting, with a button
to play something else. And on a television the remote scrolls the page rather
than jumping off it.

### Your phone is the keyboard
*Settings → Use your phone* shows a QR code.`

assert.equal(
  playNotes(RELEASE),
  'Setting this up no longer means typing a web address with a remote: point a phone\'s camera at a code on the screen and type it there instead. A release that is never going to arrive now says so while you are waiting, with a button to play something else. And on a television the remote scrolls the page rather than jumping off it.',
)

// Markdown is not rendered by Play, so none of it may reach it.
assert.equal(playNotes('## T\n\nSee **bold**, `code` and [a link](https://x.y).'), 'See bold, code and a link.')

// Too long: cut on a sentence, never over the limit.
const long = `${'A sentence of words. '.repeat(40)}`
const cut = playNotes(long)
assert.ok(cut.length <= LIMIT, `${cut.length} > ${LIMIT}`)
assert.ok(cut.endsWith('.'))

// One endless sentence: cut on a word, still under the limit.
const run = playNotes('word '.repeat(200))
assert.ok(run.length <= LIMIT && run.endsWith('…'))

// Nothing but headings and the policy line is still something Play accepts.
assert.equal(playNotes('[Code signing policy](x)\n\n## Ventic 1.0\n'), 'Bug fixes and improvements.')

console.log('play notes: ok')
