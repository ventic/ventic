// Self-check for the episode ratings grid's shading: `bun scripts/check-ratings.ts`.
//
// The grid is only worth having if its colours say something, and the two ways
// they stop doing so are both arithmetic: an absolute scale paints every show
// one colour (TMDB's episode ratings huddle between 7 and 9), and a scale that
// lets an unrated episode's 0 in pulls the bottom of every show down to it.
import assert from 'node:assert'
import { ratingScale } from '../app/utils/tmdb'
import './i18n-stub'

const rated = (rating: number, votes = 100) => ({ rating, votes })

// The show's own range: its worst episode is the pale end, its best the full one.
const show = ratingScale([rated(7.4), rated(8.4), rated(9.4)])
assert.deepEqual([show.lo, show.hi], [7.4, 9.4])
assert.equal(show.at(7.4), 0)
assert.equal(show.at(9.4), 1)
assert.equal(show.at(8.4), 0.5)

// An unaired episode has no votes and a 0 rating, and must not become the floor.
const airing = ratingScale([rated(8.0), rated(9.0), rated(0, 0)])
assert.equal(airing.lo, 7, 'an unrated episode set the bottom of the scale')

// Never narrower than two points: a show that never dips doesn't get its
// slightly-less-great episodes painted as the disasters.
const steady = ratingScale([rated(8.6), rated(8.8), rated(8.9)])
assert.ok(steady.hi - steady.lo >= 2)
assert.ok(steady.at(8.6) > 0.8, 'an 8.6 among 8.9s read as a bad episode')

// Nothing rated yet is no scale at all, which is what hides the grid.
assert.equal(ratingScale([rated(0, 0)]).hi, 0)
assert.equal(ratingScale([]).hi, 0)

console.warn('ratings: ok')
