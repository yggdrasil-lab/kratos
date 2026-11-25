import { formatAucklandDate, formatAucklandTime } from '@yggdrasil-lab/ui'
import type { DailyBiometrics, FastingCheckIn, FastingRecommendation } from '../types'

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

/**
 * Normalizes server-synced fasting feedback from daily biometrics into a FastingCheckIn.
 */
export function parseServerFasting(fb?: DailyBiometrics['fasting']): FastingCheckIn | undefined {
  if (!fb || !fb.date) return undefined
  const payload = fb.payload || {}
  return {
    id: fb.id || `server-${fb.date}`,
    date: fb.date,
    target_window: (payload.target_window as string) || '16:8',
    adherence: (fb.rating as 'completed' | 'early' | 'off_plan') || 'completed',
    energy: (payload.energy as 'high' | 'normal' | 'low') || 'normal',
    headache: (payload.headache as 'none' | 'mild' | 'sugar_spike') || 'none',
    notes: fb.notes || null,
    logged_at: fb.logged_at || new Date().toISOString(),
  }
}

export interface ResolvedFastingProtocol {
  protocolName: string
  targetWindow: string
  windowHours: string
  fuelingAnchors: string[]
  rationale?: string
  recoveryStatus?: FastingRecommendation['recovery_status']
  isLlmGenerated: boolean
  researchCitation?: string | null
}

/**
 * Resolves the active circadian fasting protocol from an AI recommendation or
 * falls back to weekend (14:10 social) vs weekday (16:8 circadian) baseline defaults.
 */
export function resolveFastingProtocol(
  dayOfWeek: number,
  recommendation?: FastingRecommendation | null
): ResolvedFastingProtocol {
  if (recommendation) {
    return {
      protocolName: recommendation.protocol_name ?? '16:8 Standard Split',
      targetWindow: recommendation.target_window ?? '16:8',
      windowHours: recommendation.window_hours ?? '12:30 PM - 8:30 PM',
      fuelingAnchors: recommendation.fueling_anchors ?? [
        '12:30 PM: Break fast with 40g protein + complex carbs',
        '07:00 PM: High protein dinner + greens',
        'Post-Dinner: 15-20 min walk to blunt glucose spike',
      ],
      rationale: recommendation.rationale,
      recoveryStatus: recommendation.recovery_status,
      isLlmGenerated: recommendation.is_llm_generated ?? false,
      researchCitation: recommendation.research_citation,
    }
  }

  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6
  if (isWeekend) {
    return {
      protocolName: '14:10 Social Baseline',
      targetWindow: '14:10',
      windowHours: '10:30 AM - 8:30 PM',
      fuelingAnchors: [
        'Mindful portions with family and friends',
        'Prioritize hydration and avoid high-sugar snacks',
      ],
      isLlmGenerated: false,
    }
  }

  return {
    protocolName: '16:8 Circadian Protocol',
    targetWindow: '16:8',
    windowHours: '12:00 PM - 8:00 PM',
    fuelingAnchors: [
      'Morning: High water intake and electrolyte hydration',
      '12:00 PM: Balanced lunch with clean complex carbs and protein',
      '07:00 PM: High-protein dinner (close window by 8:00 PM)',
    ],
    isLlmGenerated: false,
  }
}
