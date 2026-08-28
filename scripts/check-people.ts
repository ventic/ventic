// Self-check for the person page's data: `bun scripts/check-people.ts`.
//
// Two things here are only ever wrong in a way nobody notices until the page is
// in front of a user. TMDB does *not* fall back to English for a biography the
// way it does for a film's overview — it answers with an empty string — so 33 of
// the app's 72 languages would show a name, a birthday and a blank; and a
// combined credit list holds the same title twice whenever the person did two
// jobs on it, which is a duplicate card in the middle of the grid. The order is
// here for a third reason: it looked right on `popularity` and wasn't.
import assert from 'node:assert'
import process from 'node:process'
import { dateText, toPersonDetail, yearsSince } from '../app/utils/tmdb'
import './i18n-stub'

// --- Credits -----------------------------------------------------------------

const person = toPersonDetail({
  id: 1245,
  name: 'Scarlett Johansson',
  birthday: '1984-11-22',
  place_of_birth: 'New York City, New York, USA',
  profile_path: '/face.jpg',
  combined_credits: {
    cast: [
      { id: 24428, media_type: 'movie', title: 'The Avengers', vote_count: 39426, popularity: 76 },
      { id: 153, media_type: 'movie', title: 'Lost in Translation', vote_count: 8261, popularity: 14 },
      // The regression this ordering exists for: a chat show she was a guest on
      // four times outranks every film she has made on `popularity`.
      { id: 59941, media_type: 'tv', name: 'The Tonight Show', vote_count: 386, popularity: 211 },
    ],
    // Produced one she also starred in. And a person, because /search/multi
    // mixes them into results and toMedia is the same door.
    crew: [
      { id: 24428, media_type: 'movie', title: 'The Avengers', vote_count: 39426 },
      { id: 99, media_type: 'person', name: 'Somebody', vote_count: 99999 },
    ],
  },
})

assert.deepEqual(
  person.credits.map(c => `${c.type}-${c.id}`),
  ['movie-24428', 'movie-153', 'tv-59941'],
  'credits are best known first, de-duped across cast and crew, and hold no people',
)
assert.equal(person.birthplace, 'New York City, New York, USA')
assert.equal(person.deathday, '')

// A film and a show can share an id — the type is half the key.
const clash = toPersonDetail({
  id: 1,
  combined_credits: { cast: [{ id: 7, media_type: 'movie', title: 'A' }, { id: 7, media_type: 'tv', name: 'A' }] },
})
assert.equal(clash.credits.length, 2, 'movie 7 and show 7 are two different titles')

// --- The biography TMDB won't translate --------------------------------------

const translations = {
  translations: [
    { iso_639_1: 'de', data: { biography: 'Deutsch' } },
    { iso_639_1: 'en', data: { biography: 'English' } },
  ],
}

assert.equal(
  toPersonDetail({ id: 1, biography: '', translations }).biography,
  'English',
  'a language TMDB has no biography in falls back to the English one, not to a blank page',
)
assert.equal(
  toPersonDetail({ id: 1, biography: 'Slovensko', translations }).biography,
  'Slovensko',
  'the reader\'s own language wins when TMDB has it',
)
assert.equal(
  toPersonDetail({ id: 1, biography: '' }).biography,
  '',
  'no biography anywhere is an empty string, not undefined — the page hides the paragraph',
)

// --- Age ---------------------------------------------------------------------

// In every timezone, not just this machine's. TMDB gives a bare `YYYY-MM-DD`
// and `new Date` reads one as midnight *UTC*, so anywhere west of Greenwich the
// birthday landed a day early and everyone was a year older for a day — which
// only ever showed up on a machine that wasn't the one it was written on.
const here = process.env.TZ
try {
  for (const zone of ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/Ljubljana', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
    process.env.TZ = zone
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const on = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const shift = (days: number) => new Date(now.getFullYear() - 40, now.getMonth(), now.getDate() + days)

    assert.equal(yearsSince(on(shift(0))), 40, `a birthday today has been had (${zone})`)
    assert.equal(yearsSince(on(shift(1))), 39, `a birthday tomorrow has not (${zone})`)
    assert.equal(yearsSince(on(shift(-1))), 40, `a birthday yesterday has (${zone})`)
    assert.equal(yearsSince(''), 0, `no birthday is no age, never NaN (${zone})`)
    assert.equal(yearsSince(on(new Date(now.getFullYear() + 5, 0, 1))), 0, `never negative (${zone})`)

    // And the date beside the age, for the same reason: rendered off a UTC
    // midnight, every birthday, death and air date in the Americas read as the
    // day before the one TMDB sent.
    assert.match(dateText('1984-11-22'), /\b22\b/, `a date is the day TMDB named (${zone})`)
    assert.match(dateText('2001-01-01'), /\b2001\b/, `and the year it named (${zone})`)
    assert.equal(dateText(''), '', `no date is no text (${zone})`)
  }
}
finally {
  process.env.TZ = here
}

console.log('people: ok')
