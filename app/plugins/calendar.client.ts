/**
 * When the calendar is asked. Nothing here decides what it shows — see
 * utils/calendar.ts.
 *
 * A few seconds after launch, so the first page's own requests go first, and
 * then on the hour: `refresh` only asks about a show whose schedule is six
 * hours old, so most ticks cost nothing, and the hour is what catches a day
 * turning over for the air-day notice.
 */
export default defineNuxtPlugin(() => {
  const calendar = useCalendarStore()
  const tick = async () => {
    await calendar.refresh()
    await calendar.announce()
  }
  setTimeout(tick, 8000)
  setInterval(tick, 3600_000)
})
