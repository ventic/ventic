import type { Limits, Profile, Usage } from '~/utils/profiles'
import type { Media, MediaType } from '~/utils/tmdb'

/** Set once somebody has picked a profile in this process — see `chosen`. */
const CHOSEN = 'ventic-profile-chosen'

/** Away this long, and a grown-up's profile asks who is watching again. */
const AWAY = 30 * 60_000

function session(write?: boolean) {
  try {
    if (write === undefined)
      return sessionStorage.getItem(CHOSEN) === '1'
    if (write)
      sessionStorage.setItem(CHOSEN, '1')
    else
      sessionStorage.removeItem(CHOSEN)
  }
  catch {}
  return false
}

/**
 * Who is watching, and what they may. `utils/profiles.ts` owns the rules; this
 * holds the state they run over and the one PIN pad everything waits on.
 */
export const useProfilesStore = defineStore('profiles', () => {
  /** Everyone on this install, by id. Synced with the library, entry by entry. */
  const stored = useLocalStorage<Record<string, Profile>>('ventic.profiles', {})
  /** The profile the next load is built for. Never synced: each screen has its own. */
  const active = useLocalStorage('ventic.profile', DEFAULT_PROFILE)
  /**
   * The household's parental PIN, salted and hashed — one for every child's
   * profile, as a television's own parental controls have. '' until chosen.
   */
  const pin = useLocalStorage('ventic.pin', '')
  const pinSet = computed(() => !!pin.value)

  const list = computed(() => listProfiles(stored.value))
  const current = computed(() => list.value.find(p => p.id === ACTIVE) ?? list.value[0]!)
  /** A house with a child's profile in it, where grown-ups' profiles take the PIN. */
  const guarded = computed(() => list.value.some(p => p.kids))

  /**
   * Whether somebody has said who is watching since the app started. Kept in
   * sessionStorage, which a switch's reload keeps and a cold start doesn't — so
   * a launch asks, as a television's streaming apps all do, once there is
   * anybody to choose between. A child's profile never asks: it is left with
   * the PIN or not at all, and restarting the app is not a way out of it.
   */
  const chosen = ref(list.value.length < 2 || !!current.value.kids || session())

  function lock() {
    chosen.value = false
    session(false)
  }

  // The profile this page is built for was deleted on another screen, and the
  // sync just said so. Back to the gate, built for the default — never straight
  // into it, which would hand a child's screen a grown-up's library.
  watchEffect(() => {
    if (ACTIVE !== DEFAULT_PROFILE && !list.value.some(p => p.id === ACTIVE)) {
      active.value = DEFAULT_PROFILE
      lock()
      window.location.assign(localePath('/'))
    }
  })

  // A grown-up's profile left open overnight is a child's for the asking in the
  // morning: a television keeps the app alive through standby, so a cold start
  // can't be counted on to ask. Away for long enough, and it asks again.
  let hiddenAt = 0
  useEventListener(document, 'visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      return
    }
    if (hiddenAt && Date.now() - hiddenAt > AWAY && guarded.value && !current.value.kids && chosen.value) {
      lock()
      navigateTo(localePath('/profiles'))
    }
  })

  // --- The PIN pad -------------------------------------------------------------

  /** What the pad says while something waits on it; `choose` is setting a new PIN. */
  const asking = ref<{ title: string, text: string, choose: boolean } | null>(null)
  let answer: ((ok: boolean) => void) | undefined

  function pad(title: string, text: string, choose: boolean) {
    answer?.(false)
    asking.value = { title, text, choose }
    return new Promise<boolean>(resolve => (answer = resolve))
  }

  /** The pad's answer: right (or chosen), or dismissed. */
  function settle(ok: boolean) {
    const resolve = answer
    answer = undefined
    asking.value = null
    resolve?.(ok)
  }

  /**
   * A PIN typed during this visit to settings. The route middleware drops it on
   * any navigation that isn't settings to settings, so a grown-up changing three
   * things types it once, and nobody inherits it from a title unlocked a moment
   * ago.
   */
  const trusted = ref(false)

  /** Ask for the PIN. Yes outright when none has been chosen, since nothing is locked yet. */
  async function askPin(title: string, text = '') {
    if (!pin.value || trusted.value)
      return true
    const ok = await pad(title, text, false)
    trusted.value ||= ok
    return ok
  }

  async function choosePin() {
    const ok = await pad($t('Choose a parental PIN'), $t('Four digits. They lock the profiles with parental controls, and opening a grown-up\'s profile.'), true)
    trusted.value ||= ok
    return ok
  }

  /** Five wrong in a row locks the pad for a minute: four digits are only ten thousand tries. */
  let wrong = 0
  const lockedUntil = ref(0)

  async function verify(digits: string) {
    if (Date.now() < lockedUntil.value)
      return false
    const ok = await checkPin(digits, pin.value)
    wrong = ok ? 0 : wrong + 1
    if (wrong >= 5) {
      wrong = 0
      lockedUntil.value = Date.now() + 60_000
    }
    return ok
  }

  async function setPin(digits: string) {
    pin.value = await hashPin(digits)
  }

  // --- Switching -----------------------------------------------------------------

  /**
   * Into a profile, with the PIN where `needsPin` says. The one this page is
   * built for just carries on to `to`; any other is a reload.
   */
  async function enter(p: Profile, to = localePath('/')) {
    if (needsPin(p, current.value, list.value, chosen.value)
      && !(await askPin($t('Enter the parental PIN'), $t('To open {name}.', { name: profileName(p) })))) {
      return false
    }
    session(true)
    if (p.id === ACTIVE) {
      chosen.value = true
      await navigateTo(to, { replace: true })
    }
    else {
      active.value = p.id
      window.location.assign(to)
    }
    return true
  }

  function save(p: Profile) {
    stored.value = { ...stored.value, [p.id]: { ...p, at: Date.now() } }
  }

  function create(fields: Omit<Profile, 'id' | 'at'>) {
    const p = { ...fields, id: newProfileId(), at: Date.now() }
    // In the language it was made in, rather than whatever the app falls back to.
    localStorage.setItem(scoped('ventic.locale', p.id), useSettingsStore().locale)
    save(p)
    return p
  }

  /** Left in the registry as a tombstone for sync, and everything it kept dropped here. */
  function remove(p: Profile) {
    if (p.id === DEFAULT_PROFILE || p.id === ACTIVE)
      return
    stored.value = { ...stored.value, [p.id]: { id: p.id, name: '', colour: '', at: Date.now(), gone: true } }
    for (const key of Object.keys(localStorage)) {
      if (key.endsWith(`@${p.id}`))
        localStorage.removeItem(key)
    }
  }

  // --- What this profile may watch ---------------------------------------------

  /** What a discover request adds for this profile — see `discoverParams`. */
  const discover = (type: MediaType) => discoverParams(type, current.value)

  /** Titles a grown-up unlocked this session, so the next episode doesn't ask again. */
  const unlocked = new Set<string>()

  function ratingText(rating: string, limits: Limits) {
    return rating
      ? $t('This is rated {rating}, above what {name} is set to watch ({level}).', { rating, name: profileName(current.value), level: levelOf(limits).title() })
      : $t('This has no age rating, so a grown-up has to unlock it.')
  }

  /** Play, as a child's profile is allowed to: within its rating, or with the PIN. */
  async function mayWatch(type: MediaType, id: string) {
    const kids = current.value.kids
    const key = id && titleKey(type, id)
    if (!kids || (key && unlocked.has(key)))
      return true
    const rating = id ? await ratingOf(type, id) : ''
    if (allowed(type, rating, kids))
      return true
    const ok = await askPin($t('Ask a grown-up'), ratingText(rating, kids))
    if (ok && key)
      unlocked.add(key)
    return ok
  }

  /**
   * A list as a child's profile sees it, a title at a time — for the lists no
   * discover filter could narrow: search, recommendations, a filmography.
   */
  async function allowedOnly(items: Media[]) {
    const kids = current.value.kids
    if (!kids)
      return items
    const rated = await mapLimit(items, 8, m => ratingOf(m.type, m.id))
    return items.filter((m, i) => allowed(m.type, rated[i]!, kids))
  }

  // --- Watch time ----------------------------------------------------------------

  /** Today's watching. Kept on this device only — see NEVER in utils/sync. */
  const usage = useLocalStorage<Usage>(scoped('ventic.watchTime'), { day: '', seconds: 0, extra: 0 }, { mergeDefaults: true })
  // Midnight has to lift a lock nobody touches.
  const now = useNow({ interval: 30_000 })
  /** Seconds left today; Infinity with no limit. */
  const left = computed(() => secondsLeft(usage.value, current.value.kids?.minutes ?? 0, now.value.getTime()))
  const timeUp = computed(() => left.value <= 0)

  /** The player, every few seconds of a film actually playing. */
  function spend(seconds: number) {
    if (current.value.kids?.minutes)
      usage.value = spendTime(usage.value, seconds)
  }

  function extend(minutes: number) {
    usage.value = addTime(usage.value, minutes * 60)
  }

  return { list, current, guarded, chosen, pinSet, asking, trusted, lockedUntil, left, timeUp, lock, settle, askPin, choosePin, verify, setPin, enter, save, create, remove, discover, mayWatch, allowedOnly, spend, extend }
})
