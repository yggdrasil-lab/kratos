import { describe, expect, it } from 'vitest'
import type { SessionPayload, WorkoutMetrics } from '../types'
import { extractSessionTelemetry, mergeRefreshedMetricsIntoExtra } from './telemetry'

const BASE_SESSION: SessionPayload = {
  id: 'sess-1',
  routine_id: null,
  started_at: '2026-11-25T08:00:00Z',
  ended_at: '2026-11-25T08:45:00Z',
  notes: null,
  extra: {
    duration_minutes: 45,
    active_energy_kcal: 310,
    step_count: 1450,
    avg_hr: 148,
    peak_hr: 171,
    hr_recovery_60s: 24,
    effort_rating: 'hard',
    rpe: 8.4,
    trimp: 190,
    hr_zones: { z4_threshold_pct: 40, z5_anaerobic_pct: 20 },
  },
  items: [],
}

describe('extractSessionTelemetry', () => {
  it('extracts normalized telemetry fields from session.extra', () => {
    const extracted = extractSessionTelemetry(BASE_SESSION)
    expect(extracted).toEqual({
      durationMinutes: 45,
      activeEnergyKcal: 310,
      stepCount: 1450,
      avgHrBpm: 148,
      peakHrBpm: 171,
      hrRecovery60s: 24,
      effortRating: 'hard',
      rpe: 8.4,
      trimp: 190,
      hrZones: { z4_threshold_pct: 40, z5_anaerobic_pct: 20 },
    })
  })

  it('prefers refreshed Eir WorkoutMetrics over stale session.extra values', () => {
    const refreshed: WorkoutMetrics = {
      started_at: '2026-11-25T08:00:00Z',
      ended_at: '2026-11-25T08:30:00Z',
      duration_minutes: 30,
      active_energy_kcal: null,
      avg_hr_bpm: 132,
      peak_hr_bpm: null,
      step_count: 800,
      effort_rating: 'optimal',
      rpe: null,
      trimp: null,
      hr_zones: null,
      hr_recovery_60s: null,
    }
    const extracted = extractSessionTelemetry(BASE_SESSION, refreshed)
    expect(extracted.durationMinutes).toBe(30)
    expect(extracted.activeEnergyKcal).toBeNull()
    expect(extracted.avgHrBpm).toBe(132)
    expect(extracted.peakHrBpm).toBeNull()
    expect(extracted.effortRating).toBe('optimal')
    expect(extracted.hrZones).toBeUndefined()
  })
})

describe('mergeRefreshedMetricsIntoExtra', () => {
  it('clears stale telemetry keys when refreshed Eir metrics return nulls', () => {
    const refreshed: WorkoutMetrics = {
      started_at: '2026-11-25T08:00:00Z',
      ended_at: '2026-11-25T08:08:00Z',
      duration_minutes: 8,
      active_energy_kcal: null,
      avg_hr_bpm: null,
      peak_hr_bpm: null,
      step_count: null,
      effort_rating: null,
      rpe: null,
      trimp: null,
      hr_zones: null,
      hr_recovery_60s: null,
    }

    const merged = mergeRefreshedMetricsIntoExtra(
      { ...BASE_SESSION.extra, routine_name: 'Group Core' },
      refreshed,
      true,
      null
    )

    expect(merged.telemetry_locked).toBe(true)
    expect(merged.telemetry_reconciled).toBe(true)
    expect(merged.duration_minutes).toBe(8)
    expect(merged.routine_name).toBe('Group Core')
    expect(merged.avg_hr).toBeUndefined()
    expect(merged.peak_hr).toBeUndefined()
    expect(merged.active_energy_kcal).toBeUndefined()
    expect(merged.effort_rating).toBeUndefined()
    expect(merged.hr_zones).toBeUndefined()
  })

  it('preserves explicit user effort rating over refreshed rating and locks timestamps when unrefreshed', () => {
    const mergedWithoutRefresh = mergeRefreshedMetricsIntoExtra({ routine_name: 'Lift' }, null, true, 'optimal')
    expect(mergedWithoutRefresh.telemetry_locked).toBe(true)

    const refreshed: WorkoutMetrics = {
      started_at: '2026-11-25T08:00:00Z',
      ended_at: '2026-11-25T08:40:00Z',
      duration_minutes: 40,
      active_energy_kcal: 240,
      avg_hr_bpm: 138,
      effort_rating: 'optimal',
    }
    const mergedWithExplicit = mergeRefreshedMetricsIntoExtra({}, refreshed, false, 'hard')
    expect(mergedWithExplicit.effort_rating).toBe('hard')
    expect(mergedWithExplicit.avg_hr).toBe(138)
  })
})
