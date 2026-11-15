import { useCallback, useEffect, useState } from 'react'
import { db } from '../db'
import { newId } from '../outbox'
import type {
  Exercise,
  Routine,
  SessionItemPayload,
  SessionPayload,
  SetEntry,
  WorkoutRecommendation,
} from '../types'
import { resolveWeightBasis } from '../utils/session'

const DRAFT_KEY = 'current'

function createSkippedSets(count: number): SetEntry[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: newId(),
    set_number: idx + 1,
    status: 'skipped' as const,
    reps: null,
    weight_kg: null,
    duration_s: null,
    distance_m: null,
    rpe: null,
    notes: null,
    extra: {},
  }))
}

function buildRecommendedItems(
  exercises: Exercise[],
  recommendation: WorkoutRecommendation
): SessionItemPayload[] {
  return recommendation.exercises.map((recEx, idx) => {
    const matchEx = exercises.find(
      (e) =>
        (recEx.exercise_id && e.id === recEx.exercise_id) ||
        e.name.toLowerCase() === recEx.exercise_name.toLowerCase()
    )
    const weightBasis = resolveWeightBasis(matchEx, recEx.weight_basis, recEx.exercise_name)
    const targetSets = recEx.target_sets ?? 2

    return {
      id: newId(),
      exercise_id: matchEx?.id || recEx.exercise_id || exercises[0]?.id || `rec-${idx}`,
      position: idx,
      notes: recEx.notes || null,
      extra: {
        target_sets: targetSets,
        target_reps: recEx.target_reps,
        target_weight_kg: recEx.suggested_weight_kg,
        weight_basis: weightBasis,
        custom_name: !matchEx ? recEx.exercise_name : undefined,
      },
      sets: createSkippedSets(targetSets),
    }
  })
}

function buildRoutineItems(exercises: Exercise[], routine?: Routine): SessionItemPayload[] {
  return (routine?.items ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((it, idx) => {
      const matchEx = exercises.find((e) => e.id === it.exercise_id)
      const targetSets = it.target_sets ?? 2

      return {
        id: newId(),
        exercise_id: it.exercise_id,
        position: idx,
        notes: it.notes,
        extra: {
          target_sets: it.target_sets,
          target_reps: it.target_reps,
          target_weight_kg: it.target_weight_kg,
          target_duration_s: it.target_duration_s,
          weight_basis: resolveWeightBasis(matchEx),
        },
        sets: createSkippedSets(targetSets),
      }
    })
}

interface UseWorkoutSessionOptions {
  exercises: Exercise[]
  workoutRecommendation: WorkoutRecommendation | null
}

/**
 * Manages the active workout session draft in IndexedDB and provides factory
 * and mutation helpers for exercises and sets.
 */
export function useWorkoutSession({
  exercises,
  workoutRecommendation,
}: UseWorkoutSessionOptions) {
  const [session, setSession] = useState<SessionPayload | null>(null)

  useEffect(() => {
    void db.drafts.get(DRAFT_KEY).then((draft) => {
      if (draft) setSession(draft.session)
    })
  }, [])

  const updateSession = useCallback((next: SessionPayload | null) => {
    setSession(next)
    if (next) {
      void db.drafts.put({ id: DRAFT_KEY, session: next, savedAt: Date.now() })
    } else {
      void db.drafts.delete(DRAFT_KEY)
    }
  }, [])

  const startSession = useCallback(
    (routine?: Routine) => {
      const recommendationMatchesRoutine =
        !routine ||
        !workoutRecommendation?.routine_name ||
        routine.name.toLowerCase() === workoutRecommendation.routine_name.toLowerCase()
      const useRecommended = Boolean(
        recommendationMatchesRoutine &&
          workoutRecommendation?.exercises &&
          workoutRecommendation.exercises.length > 0
      )
      const items =
        useRecommended && workoutRecommendation
          ? buildRecommendedItems(exercises, workoutRecommendation)
          : buildRoutineItems(exercises, routine)

      const routineName = useRecommended
        ? workoutRecommendation?.routine_name
        : routine?.name || workoutRecommendation?.routine_name || 'Current Workout'

      updateSession({
        id: newId(),
        routine_id: routine?.id ?? null,
        started_at: new Date().toISOString(),
        ended_at: null,
        notes: null,
        extra: { routine_name: routineName },
        items,
      })
    },
    [exercises, workoutRecommendation, updateSession]
  )

  const addExercise = useCallback(
    (exercise: Exercise) => {
      if (!session) return
      const newItem: SessionItemPayload = {
        id: newId(),
        exercise_id: exercise.id,
        position: session.items.length,
        notes: null,
        extra: {},
        sets: createSkippedSets(1),
      }
      updateSession({ ...session, items: [...session.items, newItem] })
    },
    [session, updateSession]
  )

  const removeExercise = useCallback(
    (itemId: string) => {
      if (!session) return
      updateSession({
        ...session,
        items: session.items.filter((it) => it.id !== itemId),
      })
    },
    [session, updateSession]
  )

  const addSet = useCallback(
    (itemIndex: number) => {
      if (!session) return
      const newItems = [...session.items]
      const item = { ...newItems[itemIndex] }
      const lastSet = item.sets[item.sets.length - 1]
      item.sets = [
        ...item.sets,
        {
          id: newId(),
          set_number: item.sets.length + 1,
          status: 'done',
          reps: lastSet?.reps ?? null,
          weight_kg: lastSet?.weight_kg ?? null,
          duration_s: null,
          distance_m: null,
          rpe: null,
          notes: null,
          extra: {},
        },
      ]
      newItems[itemIndex] = item
      updateSession({ ...session, items: newItems })
    },
    [session, updateSession]
  )

  const updateSet = useCallback(
    (itemIndex: number, setIndex: number, field: 'weight_kg' | 'reps', value: number | null) => {
      if (!session) return
      const newItems = [...session.items]
      const sets = [...newItems[itemIndex].sets]
      const prev = sets[setIndex]
      const nextReps = field === 'reps' ? value : prev.reps
      const nextWeight = field === 'weight_kg' ? value : prev.weight_kg
      const status = nextReps === null && nextWeight === null ? 'skipped' : 'done'
      sets[setIndex] = { ...prev, [field]: value, status }
      newItems[itemIndex] = { ...newItems[itemIndex], sets }
      updateSession({ ...session, items: newItems })
    },
    [session, updateSession]
  )

  const removeSet = useCallback(
    (itemIndex: number, setIndex: number) => {
      if (!session) return
      const newItems = session.items.map((it, i) => {
        if (i !== itemIndex) return it
        const sets = it.sets
          .filter((_, j) => j !== setIndex)
          .map((s, j) => ({ ...s, set_number: j + 1 }))
        return { ...it, sets }
      })
      updateSession({ ...session, items: newItems })
    },
    [session, updateSession]
  )

  return {
    session,
    updateSession,
    startSession,
    addExercise,
    removeExercise,
    addSet,
    updateSet,
    removeSet,
  }
}
