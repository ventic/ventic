/**
 * The profile gate. Everything it decides is `stores/profiles.ts`'s, and this is
 * only where: the one place every route passes through, a cast and a deep link
 * included, so no page has to remember to check.
 */
export default defineNuxtRouteMiddleware(async (to, from) => {
  const profiles = useProfilesStore()
  const settings = localePath('/settings')
  const inSettings = (path: string) => path === settings || path.startsWith(`${settings}/`)

  // A PIN typed in settings lasts for that one visit.
  if (!inSettings(to.path) || !inSettings(from.path))
    profiles.trusted = false

  if (to.path === localePath('/profiles'))
    return
  // Nobody has said who is watching yet, or a child's time is up for today.
  if (!profiles.chosen || profiles.timeUp)
    return navigateTo({ path: localePath('/profiles'), query: { to: to.fullPath } })

  if (!profiles.current.kids)
    return
  // A general-purpose torrent client and somebody's IPTV subscription: neither
  // has a rating to check, so neither is a child's.
  if (to.path === localePath('/downloads') || to.path === localePath('/live'))
    return navigateTo(localePath('/'))
  if (inSettings(to.path) && !(await profiles.askPin($t('Ask a grown-up'), $t('Settings are locked on this profile.'))))
    return abortNavigation()
  if (to.path === localePath('/watch') && !(await profiles.mayWatch(to.query.type === 'tv' ? 'tv' : 'movie', String(to.query.id ?? ''))))
    return abortNavigation()
})
