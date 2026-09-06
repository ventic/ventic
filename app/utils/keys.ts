/**
 * The player's keyboard shortcuts, and what the user has changed them to.
 *
 * An action is what the player does; a chord is the press that does it, as
 * `chord()` spells one — `e.key` with `Ctrl+`/`Alt+`/`Meta+` in front, and
 * `Shift+` only where `e.key` hasn't already folded it in: a letter arrives as
 * `Z`, an arrow as `Shift+ArrowLeft`. `e.key` rather than `e.code` on purpose.
 * The settings page says "press a key" and then shows what was pressed, and on
 * an AZERTY keyboard the cap that says A had better not be shown as Q.
 *
 * The store keeps only what differs from the table below, so a default that
 * changes in a later build still reaches everyone who never touched it, and
 * "reset" is an empty map. Desktop only: the section hides on Android, where
 * the remote's keys belong to the d-pad plugin and a phone has no keyboard
 * worth binding. The digits are not here — 0–9 always jump to that tenth of
 * the film, and Escape and the d-pad's own moves stay the navigation's.
 *
 * `bun run check:keys` holds the arithmetic and the seams.
 */
export const KEY_ACTIONS = [
  { value: 'play', key: ' ', title: () => $t('Play / pause') },
  { value: 'controls', key: 'Enter', title: () => $t('Show the controls') },
  { value: 'back', key: 'ArrowLeft', title: () => $t('Back 5 seconds') },
  { value: 'forward', key: 'ArrowRight', title: () => $t('Forward 5 seconds') },
  { value: 'backMore', key: 'j', title: () => $t('Back 10 seconds') },
  { value: 'forwardMore', key: 'l', title: () => $t('Forward 10 seconds') },
  { value: 'volumeUp', key: 'ArrowUp', title: () => $t('Volume up') },
  { value: 'volumeDown', key: 'ArrowDown', title: () => $t('Volume down') },
  { value: 'mute', key: 'm', title: () => $t('Mute') },
  { value: 'fullscreen', key: 'f', title: () => $t('Fullscreen') },
  { value: 'subs', key: 'c', title: () => $t('Subtitles on / off') },
  { value: 'subsMenu', key: 's', title: () => $t('Subtitle panel') },
  // mpv's own pair, kept because muscle memory expects them.
  { value: 'subDelayBack', key: 'z', title: () => $t('Subtitles 0.1 s earlier') },
  { value: 'subDelayForward', key: 'Z', title: () => $t('Subtitles 0.1 s later') },
  { value: 'subDelayReset', key: 'Ctrl+z', title: () => $t('Reset subtitle offset') },
  { value: 'slower', key: '[', title: () => $t('Slower') },
  { value: 'faster', key: ']', title: () => $t('Faster') },
  { value: 'start', key: 'Home', title: () => $t('Jump to the start') },
  { value: 'end', key: 'End', title: () => $t('Jump to the end') },
] as const

export type KeyAction = typeof KEY_ACTIONS[number]['value']

/** What `ventic.keys` holds: the actions the user moved, and `''` for one they took away. */
export type KeyOverrides = Partial<Record<KeyAction, string>>

/** A press as a chord, or `''` for a modifier on its own, which is not one yet. */
export function chord(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>) {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))
    return ''
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && e.key.length > 1 && 'Shift']
  return [...mods.filter(Boolean), e.key].join('+')
}

/** Every action with the key it answers to today. */
export function keyBindings(overrides: KeyOverrides) {
  return Object.fromEntries(KEY_ACTIONS.map(a => [a.value, overrides[a.value] ?? a.key])) as Record<KeyAction, string>
}

/** The same, the way the player looks it up. */
export function keysByChord(overrides: KeyOverrides) {
  const map: Partial<Record<string, KeyAction>> = {}
  for (const [action, key] of Object.entries(keyBindings(overrides))) {
    if (key)
      map[key] = action as KeyAction
  }
  return map
}

/**
 * `action` now answers to `key` (or to nothing, for `''`). One chord, one
 * action: whichever row held the key before is left unbound rather than left
 * to fight over it. Only differences from the defaults are kept.
 */
export function bindKey(overrides: KeyOverrides, action: KeyAction, key: string): KeyOverrides {
  const bound = keyBindings({ ...overrides, [action]: key })
  const next: KeyOverrides = {}
  for (const a of KEY_ACTIONS) {
    const k = key && a.value !== action && bound[a.value] === key ? '' : bound[a.value]
    if (k !== a.key)
      next[a.value] = k
  }
  return next
}

/** A chord as the settings page shows it: `Shift+Z`, `Ctrl+←`, `Space`. */
export function keyLabel(c: string) {
  if (!c)
    return ''
  // The plus key is the one key the separator can't split on.
  const parts = c.endsWith('+') ? [...c.slice(0, -1).split('+').filter(Boolean), '+'] : c.split('+')
  const key = parts.pop()!
  const names: Record<string, string> = { ' ': $t('Space'), 'ArrowLeft': '←', 'ArrowRight': '→', 'ArrowUp': '↑', 'ArrowDown': '↓' }
  const name = names[key] ?? (key.length !== 1 ? key : key !== key.toLowerCase() ? `Shift+${key}` : key.toUpperCase())
  return [...parts, name].join('+')
}
