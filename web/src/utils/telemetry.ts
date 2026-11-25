import {
  initGlobalErrorReporter as initSharedGlobalErrorReporter,
  reportClientError as reportSharedClientError,
  type ClientErrorPayload,
  type TelemetryOptions,
} from '@yggdrasil-lab/ui'
import type { HRZonesData } from '../components/HRZoneBar'
import type { EffortRating, SessionPayload, WorkoutMetrics } from '../types'

export type { ClientErrorPayload, TelemetryOptions }

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const ENDPOINT = `${BASE}/client-errors`

export const CLEARABLE_METRIC_KEYS = [
  'active_energy_kcal',
  'avg_hr',
  'peak_hr',
  'step_count',
  'rpe',
  'trimp',
  'hr_zones',
  'hr_recovery_60s',
] as const

export interface ExtractedSessionTelemetry {
  durationMinutes: number | null
  activeEnergyKcal: number | null
  stepCount: number | null
  avgHrBpm: number | null
  peakHrBpm: number | null
  hrRecovery60s: number | null
  effortRating: string
  rpe: number | null
  trimp: number | null
  hrZones: HRZonesData | undefined
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/**
 * Extracts normalized wearable telemetry fields from a session's extra payload,
 * preferring freshly fetched Eir WorkoutMetrics when supplied.
 */
export function extractSessionTelemetry(
  session: SessionPayload,
  refreshedMetrics?: WorkoutMetrics | null
): ExtractedSessionTelemetry {
  if (refreshedMetrics) {
    return {
      durationMinutes: refreshedMetrics.duration_minutes,
      activeEnergyKcal: refreshedMetrics.active_energy_kcal ?? null,
      stepCount: refreshedMetrics.step_count ?? null,
      avgHrBpm: refreshedMetrics.avg_hr_bpm ?? null,
      peakHrBpm: refreshedMetrics.peak_hr_bpm ?? null,
      hrRecovery60s: refreshedMetrics.hr_recovery_60s ?? null,
      effortRating: typeof refreshedMetrics.effort_rating === 'string' ? refreshedMetrics.effort_rating : '',
      rpe: refreshedMetrics.rpe ?? null,
      trimp: refreshedMetrics.trimp ?? null,
      hrZones: (refreshedMetrics.hr_zones as HRZonesData | null | undefined) ?? undefined,
    }
  }
  const extra = session.extra || {}
  return {
    durationMinutes: readOptionalNumber(extra.duration_minutes),
    activeEnergyKcal: readOptionalNumber(extra.active_energy_kcal),
    stepCount: readOptionalNumber(extra.step_count),
    avgHrBpm: readOptionalNumber(extra.avg_hr),
    peakHrBpm: readOptionalNumber(extra.peak_hr),
    hrRecovery60s: readOptionalNumber(extra.hr_recovery_60s),
    effortRating: typeof extra.effort_rating === 'string' ? extra.effort_rating : '',
    rpe: readOptionalNumber(extra.rpe),
    trimp: readOptionalNumber(extra.trimp),
    hrZones: extra.hr_zones as HRZonesData | undefined,
  }
}

/**
 * Merges refreshed Eir WorkoutMetrics into session.extra, setting lock flags
 * and clearing stale telemetry keys whenever the refreshed payload returns null.
 */
export function mergeRefreshedMetricsIntoExtra(
  baseExtra: Record<string, unknown>,
  refreshed: WorkoutMetrics | null,
  timesChanged: boolean,
  explicitEffort: EffortRating | null
): Record<string, unknown> {
  if (!refreshed) {
    return timesChanged ? { ...baseExtra, telemetry_locked: true } : baseExtra
  }
  const next: Record<string, unknown> = {
    ...baseExtra,
    telemetry_locked: true,
    telemetry_reconciled: true,
    duration_minutes: refreshed.duration_minutes,
  }
  const valueMap: Record<(typeof CLEARABLE_METRIC_KEYS)[number], unknown> = {
    active_energy_kcal: refreshed.active_energy_kcal,
    avg_hr: refreshed.avg_hr_bpm,
    peak_hr: refreshed.peak_hr_bpm,
    step_count: refreshed.step_count,
    rpe: refreshed.rpe,
    trimp: refreshed.trimp,
    hr_zones: refreshed.hr_zones,
    hr_recovery_60s: refreshed.hr_recovery_60s,
  }
  for (const key of CLEARABLE_METRIC_KEYS) {
    const val = valueMap[key]
    if (val === null || val === undefined) {
      delete next[key]
    } else {
      next[key] = val
    }
  }
  const resolvedEffort = explicitEffort ?? refreshed.effort_rating ?? null
  if (resolvedEffort === null || resolvedEffort === undefined) {
    delete next.effort_rating
  } else {
    next.effort_rating = resolvedEffort
  }
  return next
}

/**
 * Reports a client-side exception to the Kratos backend telemetry endpoint
 * using shared deduplication from @yggdrasil-lab/ui.
 */
export function reportClientError(
  error: unknown,
  context?: Record<string, unknown>,
  options?: TelemetryOptions
): Promise<void> {
  return reportSharedClientError(error, context, {
    endpoint: ENDPOINT,
    ...options,
  })
}

/**
 * Registers global window error and unhandledrejection listeners targeting Kratos telemetry.
 */
export function initGlobalErrorReporter(options?: TelemetryOptions): void {
  initSharedGlobalErrorReporter({
    endpoint: ENDPOINT,
    ...options,
  })
}
