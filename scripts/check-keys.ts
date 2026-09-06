// Self-check for the keyboard shortcuts: `bun scripts/check-keys.ts`.
//
// A press has to be spelled the same way twice — once when the settings page
// records it, once when the player looks it up — and the store holds only what
// the user changed. Both are arithmetic, and both are held here, along with the
// seams no compiler sees: that the player really reads the store, and that the
// section stays off Android.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { bindKey, chord, KEY_ACTIONS, keyLabel, keysByChord } from '../app/utils/keys'
import './i18n-stub'

function press(key: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>> = {}) {
  return chord({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods })
}

// --- Spelling a press --------------------------------------------------------

assert.equal(press('z'), 'z')
assert.equal(press('Z', { shiftKey: true }), 'Z', 'a letter carries its own shift')
assert.equal(press('ArrowLeft', { shiftKey: true }), 'Shift+ArrowLeft', 'an arrow does not')
assert.equal(press('f', { ctrlKey: true, altKey: true }), 'Ctrl+Alt+f')
assert.equal(press('Shift', { shiftKey: true }), '', 'a bare modifier is not a chord yet')

assert.equal(keyLabel('Z'), 'Shift+Z')
assert.equal(keyLabel('z'), 'Z')
assert.equal(keyLabel(' '), 'Space')
assert.equal(keyLabel('Ctrl+ArrowLeft'), 'Ctrl+←')
assert.equal(keyLabel('+'), '+', 'the plus key survives the separator')
assert.equal(keyLabel(''), '')

// --- The defaults ------------------------------------------------------------

const used = new Map<string, string>()
for (const a of KEY_ACTIONS) {
  assert.ok(a.key, `${a.value} ships bound`)
  assert.ok(!used.has(a.key), `${a.key} is both ${used.get(a.key)} and ${a.value}`)
  used.set(a.key, a.value)
}
assert.equal(keysByChord({}).z, 'subDelayBack')

// --- What the user changed ---------------------------------------------------

let o = bindKey({}, 'mute', 'n')
assert.deepEqual(o, { mute: 'n' }, 'only the change is kept')
assert.deepEqual(bindKey(o, 'mute', 'm'), {}, 'and back on the default it is dropped')
o = bindKey({}, 'mute', 'f')
assert.deepEqual(o, { mute: 'f', fullscreen: '' }, 'a key taken from another action leaves that one unbound')
assert.equal(keysByChord(o).f, 'mute')
assert.ok(!('' in keysByChord(o)), 'and nothing answers to no key')
assert.deepEqual(bindKey(o, 'mute', ''), { mute: '', fullscreen: '' }, 'clearing a key clears just that key')

// --- The seams ---------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const player = read('../app/components/MpvPlayer.vue')
assert.match(player, /keysByChord\(settings\.keys\)/, 'the player reads the user\'s bindings, not a table of its own')
assert.match(player, /chord\(e\)/, 'and spells a press the way the settings page recorded it')
assert.match(read('../app/pages/settings/keyboard.vue'), /bindKey\(/, 'the settings page binds through the same function')
assert.match(read('../app/stores/settings.ts'), /onAndroid\(\) \? \[\]/, 'the section stays off Android, where the keys are the d-pad plugin\'s')

console.info('keys: ok')
