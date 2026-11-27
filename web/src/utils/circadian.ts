import { formatAucklandDate, formatAucklandTime } from '@yggdrasil-lab/ui'

const EXPLICIT_TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * Circadian day utilities for Kratos.
 *
 * To accommodate 24/7 midnight gym sessions, the circadian day rolls over
 * at 04:00 AM (Pacific/Auckland), aligned with the sleep boundary.
 * Sessions between 00:00 and 03:59 AM belong to the preceding day.
 */

export function getCircadianDate(d: Date = new Date()): string {
  const adjusted = new Date(d.getTime() - 4 * 60 * 60 * 1000)
  return formatAucklandDate(adjusted)
}

export function getCircadianDayOfWeek(d: Date = new Date()): number {
  // Monday = 0, Tuesday = 1, ..., Sunday = 6
  const [y, m, day] = getCircadianDate(d).split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7
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

function formatLocal12Hour(iso?: string | null): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return ''
  let rawHours = dt.getHours()
  let minutes = String(dt.getMinutes()).padStart(2, '0')
  if (EXPLICIT_TZ_RE.test(iso.trim())) {
    const [hh, mm] = formatAucklandTime(dt).split(':')
    rawHours = Number(hh) % 24
    minutes = mm
  }
  const period = rawHours >= 12 ? 'PM' : 'AM'
  const hour12 = rawHours % 12 === 0 ? 12 : rawHours % 12
  return `${hour12}:${minutes} ${period}`
}

/**
 * Formats an ISO start/end pair as a deterministic local 12-hour time window
 * (e.g. "11:30 AM - 12:25 PM"), falling back to start time when `endedAt` is absent.
 */
export function formatSessionTimeRange(
  startedAt?: string | null,
  endedAt?: string | null
): string {
  const startLabel = formatLocal12Hour(startedAt)
  if (!startLabel) return ''
  const endLabel = formatLocal12Hour(endedAt)
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel
}
