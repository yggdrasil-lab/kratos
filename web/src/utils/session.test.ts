import { describe, expect, it } from 'vitest'
import type { Exercise, Routine, SessionPayload } from '../types'
import {
  computeSessionVolumeAndSets,
  getSessionLabel,
  isPerHandExercise,
  resolveWeightBasis,
} from './session'

describe('isPerHandExercise and resolveWeightBasis', () => {
  it('prioritizes authoritative backend weight_basis over name substring heuristics', () => {
    const dumbbellTotalExercise: Pick<Exercise, 'name' | 'weight_basis'> = {
      name: 'Dumbbell Pullover',
      weight_basis: 'total',
    }
    expect(isPerHandExercise(dumbbellTotalExercise)).toBe(false)
    expect(resolveWeightBasis(dumbbellTotalExercise)).toBe('total')

    const explicitTotalOverride: Pick<Exercise, 'name' | 'weight_basis'> = {
      name: 'Bench Press (Dumbbell)',
      weight_basis: 'per_hand',
    }
    expect(isPerHandExercise(explicitTotalOverride, 'total')).toBe(false)
    expect(resolveWeightBasis(explicitTotalOverride, 'total')).toBe('total')
    expect(isPerHandExercise(explicitTotalOverride)).toBe(true)
  })

  it('falls back to exercise name heuristic only when no weight_basis is provided', () => {
    expect(isPerHandExercise(null, undefined, 'Incline Dumbbell Curl')).toBe(true)
    expect(isPerHandExercise(null, undefined, 'Barbell Squat')).toBe(false)
  })
})

describe('computeSessionVolumeAndSets', () => {
  const exercises: Pick<Exercise, 'id' | 'name' | 'weight_basis'>[] = [
    { id: 'ex-db', name: 'Bench Press (Dumbbell)', weight_basis: 'per_hand' },
    { id: 'ex-bb', name: 'Barbell Squat', weight_basis: 'total' },
  ]

  it('doubles per-hand dumbbell volume and ignores skipped sets', () => {
    const session: SessionPayload = {
      id: 's-1',
      routine_id: null,
      started_at: '2026-11-25T08:00:00Z',
      ended_at: '2026-11-25T08:45:00Z',
      notes: null,
      extra: {},
      items: [
        {
          id: 'i-1',
          exercise_id: 'ex-db',
          position: 0,
          notes: null,
          extra: {},
          sets: [
            {
              id: 'st-1',
              set_number: 1,
              status: 'done',
              reps: 10,
              weight_kg: 20,
              duration_s: null,
              distance_m: null,
              rpe: null,
              notes: null,
              extra: {},
            },
            {
              id: 'st-2',
              set_number: 2,
              status: 'skipped',
              reps: 10,
              weight_kg: 20,
              duration_s: null,
              distance_m: null,
              rpe: null,
              notes: null,
              extra: {},
            },
          ],
        },
        {
          id: 'i-2',
          exercise_id: 'ex-bb',
          position: 1,
          notes: null,
          extra: {},
          sets: [
            {
              id: 'st-3',
              set_number: 1,
              status: 'done',
              reps: 5,
              weight_kg: 100,
              duration_s: null,
              distance_m: null,
              rpe: null,
              notes: null,
              extra: {},
            },
          ],
        },
      ],
    }

    expect(computeSessionVolumeAndSets(session, exercises)).toEqual({
      volume: 20 * 10 * 2 + 100 * 5,
      sets: 2,
    })
  })
})

describe('getSessionLabel', () => {
  const routines: Routine[] = [
    { id: 'r-1', name: 'Upper Body A', notes: null, extra: {}, items: [] },
  ]

  it('prefers explicit custom routine_name over generic placeholders and falls back cleanly', () => {
    const customSession: SessionPayload = {
      id: 's-1',
      routine_id: 'r-1',
      started_at: '2026-11-25T08:00:00Z',
      ended_at: null,
      notes: null,
      extra: { routine_name: 'Gym Session' },
      items: [],
    }
    expect(getSessionLabel(customSession, routines)).toBe('Upper Body A')

    const sportSession: SessionPayload = {
      id: 's-2',
      routine_id: null,
      started_at: '2026-11-25T08:00:00Z',
      ended_at: null,
      notes: null,
      extra: { session_type: 'sport', sport_name: 'Badminton' },
      items: [],
    }
    expect(getSessionLabel(sportSession, [])).toBe('Badminton')
  })
})
