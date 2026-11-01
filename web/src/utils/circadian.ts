/**
 * Circadian day utilities for Kratos.
 *
 * To accommodate 24/7 midnight gym sessions, the circadian day rolls over
 * at 04:00 AM (Pacific/Auckland), aligned with the sleep boundary.
 * Sessions between 00:00 and 03:59 AM belong to the preceding day.
 */

export function getCircadianDate(d: Date = new Date()): string {
  const adjusted = new Date(d.getTime() - 4 * 60 * 60 * 1000)
  const y = adjusted.getFullYear()
  const m = String(adjusted.getMonth() + 1).padStart(2, '0')
  const day = String(adjusted.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getCircadianDayOfWeek(d: Date = new Date()): number {
  // Monday = 0, Tuesday = 1, ..., Sunday = 6
  const adjusted = new Date(d.getTime() - 4 * 60 * 60 * 1000)
  return (adjusted.getDay() + 6) % 7
}

export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export const DAY_SHORTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatFriendlyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dayName = DAY_NAMES[(dt.getDay() + 6) % 7]
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${dayName}, ${months[dt.getMonth()]} ${dt.getDate()}`
}
