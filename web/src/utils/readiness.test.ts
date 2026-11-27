import { describe, expect, it } from 'vitest'
import type { DailyBiometrics, Routine, WorkoutRecommendation } from '../types'
import {
  READINESS_STYLE_MAP,
  resolveReadinessSummary,
  resolveTodayRoutineState,
  resolveVitalsDisplay,
} from './readiness'

describe('resolveReadinessSummary', () => {
  it('maps backend optimal, moderate, and fatigued tiers without client threshold overrides', () => {
    const biometricsWithLowSleepButBackendOptimal: DailyBiometrics = {
      date: '2026-11-25',
      sleep_duration_hours: 4.5,
      hrv_ms: 28,
      readiness: {
        tier: 'optimal',
        label: 'High Readiness',
        message: 'Backend authoritative verdict.',
      },
    }

    const optimal = resolveReadinessSummary(biometricsWithLowSleepButBackendOptimal)
    expect(optimal.tier).toBe('optimal')
    expect(optimal.label).toBe('High Readiness')
    expect(optimal.message).toBe('Backend authoritative verdict.')
    expect(optimal.headerVariant).toBe(READINESS_STYLE_MAP.optimal.headerVariant)
    expect(optimal.borderClass).toBe(READINESS_STYLE_MAP.optimal.borderClass)

    const moderate = resolveReadinessSummary({
      date: '2026-11-25',
      readiness: {
        tier: 'moderate',
        label: 'Moderate Fatigue',
        message: 'Cap intensity around RPE 7-8.',
      },
    })
    expect(moderate.tier).toBe('moderate')
    expect(moderate.headerVariant).toBe('amber')
    expect(moderate.emoji).toBe('🟡')

    const fatigued = resolveReadinessSummary({
      date: '2026-11-25',
      readiness: {
        tier: 'fatigued',
        label: 'Low Recovery',
        message: 'Recommend volume scaling.',
      },
    })
    expect(fatigued.tier).toBe('fatigued')
    expect(fatigued.headerVariant).toBe('rose')
    expect(fatigued.emoji).toBe('🔴')
  })

  it('returns an explicit neutral unavailable summary when biometrics or readiness is absent', () => {
    const nullResult = resolveReadinessSummary(null)
    expect(nullResult.tier).toBe('unavailable')
    expect(nullResult.label).toBe('Readiness Unavailable')
    expect(nullResult.headerVariant).toBe('slate')
    expect(nullResult.label).not.toContain('High Readiness')

    const absentReadiness = resolveReadinessSummary({
      date: '2026-11-25',
      sleep_duration_hours: 8.2,
      hrv_ms: 60,
      readiness: null,
    })
    expect(absentReadiness.tier).toBe('unavailable')
    expect(absentReadiness.label).toBe('Readiness Unavailable')
  })
})

describe('resolveTodayRoutineState', () => {
  const routines: Routine[] = [
    {
      id: 'r-1',
      name: 'Upper Body A',
      notes: null,
      extra: {},
      items: [
        {
          id: 'ri-1',
          routine_id: 'r-1',
          exercise_id: 'ex-1',
          position: 0,
          target_sets: 3,
          target_reps: 8,
          target_weight_kg: 30,
          target_duration_s: null,
          notes: null,
        },
      ],
    },
  ]

  it('does not leak resistance routines on sport or rest days with empty recommended exercises', () => {
    const sportRec: WorkoutRecommendation = {
      date: '2026-11-25',
      routine_name: 'Badminton Match Play',
      readiness_adaptation: 'Court freshness',
      target_rir: 'RIR 2-3',
      volume_landmark: 'Sport Fueling',
      rationale: 'Preserve legs',
      exercises: [],
      recovery_status: 'optimal',
    }
    const state = resolveTodayRoutineState(routines, sportRec)
    expect(state.activeRoutine).toBeNull()
    expect(state.dayHeadline).toBe('Badminton Match Play')
    expect(state.daySubtitle).toBe('No routines scheduled for today')
  })

  it('honors manual routine override over sport recommendation', () => {
    const state = resolveTodayRoutineState(routines, null, routines[0])
    expect(state.activeRoutine?.id).toBe('r-1')
    expect(state.dayHeadline).toBe('Upper Body A')
    expect(state.daySubtitle).toBe('1 exercises configured')
  })
})

describe('resolveVitalsDisplay', () => {
  it('prefers overnight_hrv_ms over hrv_ms and surfaces positive nap duration', () => {
    const vitals = resolveVitalsDisplay({
      date: '2026-11-27',
      hrv_ms: '50.02',
      overnight_hrv_ms: '42.22',
      sleep_duration_hours: 6.64,
      sleep_deep_hours: 0.84,
      sleep_rem_hours: 1.74,
      nap_duration_hours: 2.51,
      nap_count: 1,
      total_sleep_hours: 9.15,
      naps: [
        {
          start_at: '2026-11-27T11:29:24+13:00',
          end_at: '2026-11-27T14:18:19+13:00',
          duration_hours: 2.51,
        },
      ],
    })

    expect(vitals.sleepHours).toBe(6.64)
    expect(vitals.deepSleepHours).toBe(0.84)
    expect(vitals.napHours).toBe(2.51)
    expect(vitals.hrvMs).toBe(42.22)
  })

  it('falls back to hrv_ms and hides zero nap duration on legacy payloads', () => {
    const vitals = resolveVitalsDisplay({
      date: '2026-11-25',
      hrv_ms: '50.02',
      overnight_hrv_ms: null,
      sleep_duration_hours: 7.5,
      nap_duration_hours: 0,
      resting_hr_bpm: 58,
      latest_weight_kg: '74.4',
    })

    expect(vitals.hrvMs).toBe(50.02)
    expect(vitals.napHours).toBeNull()
    expect(vitals.rhrBpm).toBe(58)
    expect(vitals.weightKg).toBe(74.4)
  })
})
