import { useCallback, useEffect, useState } from 'react'
import { db } from '../db'
import { isValidUuid, newId } from '../outbox'
import type {
  Exercise,
  Routine,
  SessionItemPayload,
  SessionPayload,
  SetEntry,
  WorkoutRecommendation,
} from '../types'
import { getCircadianDate } from '../utils/circadian'
import { resolveWeightBasis } from '../utils/session'
import { isSessionOnCircadianDate } from '../utils/sessionMetrics'

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

function matchExerciseForRecommendation(
  exercises: Exercise[],
  rawName: string | undefined
): Exercise | undefined {
  const targetName = (rawName || '').trim().toLowerCase()
  if (!targetName) return undefined
  return (
    exercises.find((e) => e.name.trim().toLowerCase() === targetName) ||
    exercises.find((e) => {
      const candidate = e.name.trim().toLowerCase()
      return candidate.length > 0 && (candidate.includes(targetName) || targetName.includes(candidate))
    })
  )
}

function buildRecommendedItems(
  exercises: Exercise[],
  recommendation: WorkoutRecommendation
): SessionItemPayload[] {
  const items: SessionItemPayload[] = []
  const fallbackExerciseId = isValidUuid(exercises[0]?.id) ? exercises[0].id : null

  for (const recEx of recommendation.exercises) {
    const matchEx = matchExerciseForRecommendation(exercises, recEx.exercise_name)
    const resolvedExerciseId =
      (isValidUuid(matchEx?.id) ? matchEx.id : null) ||
      fallbackExerciseId
    if (!resolvedExerciseId) continue

    const targetSets = recEx.target_sets ?? 2
    items.push({
      id: newId(),
      exercise_id: resolvedExerciseId,
      position: items.length,
      notes: recEx.notes || null,
      extra: {
        target_sets: targetSets,
        target_reps: recEx.target_reps,
        target_weight_kg: recEx.suggested_weight_kg,
        weight_basis: resolveWeightBasis(matchEx, recEx.weight_basis, recEx.exercise_name),
        custom_name: !matchEx || !isValidUuid(matchEx.id) ? recEx.exercise_name : undefined,
      },
      sets: createSkippedSets(targetSets),
    })
  }
  return items
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

function resolveRetroactiveItems(
  existingSession: SessionPayload,
  exercises: Exercise[],
  workoutRecommendation: WorkoutRecommendation | null,
  routine?: Routine
): SessionItemPayload[] {
  if (existingSession.items && existingSession.items.length > 0) {
    return existingSession.items
  }
  const recommendationMatchesRoutine = Boolean(
    routine &&
      workoutRecommendation?.routine_name &&
      routine.name.toLowerCase() === workoutRecommendation.routine_name.toLowerCase()
  )
  const isToday = isSessionOnCircadianDate(existingSession, getCircadianDate())
  const hasRecExercises = Boolean(
    workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0
  )
  const useRecommended = Boolean(
    recommendationMatchesRoutine &&
      hasRecExercises &&
      (isToday || !(routine?.items && routine.items.length > 0))
  )
  return useRecommended && workoutRecommendation
    ? buildRecommendedItems(exercises, workoutRecommendation)
    : buildRoutineItems(exercises, routine)
}

function buildNewSessionPayload(
  exercises: Exercise[],
  workoutRecommendation: WorkoutRecommendation | null,
  routine?: Routine
): SessionPayload {
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

  return {
    id: newId(),
    routine_id: routine?.id ?? null,
    started_at: new Date().toISOString(),
    ended_at: null,
    notes: null,
    extra: { routine_name: routineName },
    items,
  }
}

function buildUpdatedSetItems(
  items: SessionItemPayload[],
  itemIndex: number,
  setIndex: number,
  field: 'weight_kg' | 'reps',
  value: number | null
): SessionItemPayload[] {
  const newItems = [...items]
  const sets = [...newItems[itemIndex].sets]
  const prev = sets[setIndex]
  const nextReps = field === 'reps' ? value : prev.reps
  const nextWeight = field === 'weight_kg' ? value : prev.weight_kg
  const status = nextReps === null && nextWeight === null ? 'skipped' : 'done'
  sets[setIndex] = { ...prev, [field]: value, status }
  newItems[itemIndex] = { ...newItems[itemIndex], sets }
  return newItems
}

function buildAppendedSetItems(items: SessionItemPayload[], itemIndex: number): SessionItemPayload[] {
  const newItems = [...items]
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
  return newItems
}

function buildRetroactivePayload(
  existingSession: SessionPayload,
  exercises: Exercise[],
  workoutRecommendation: WorkoutRecommendation | null,
  routine?: Routine
): SessionPayload {
  const resolvedName =
    (typeof existingSession.extra?.routine_name === 'string' && existingSession.extra.routine_name) ||
    routine?.name ||
    'Workout'
  return {
    ...existingSession,
    routine_id: existingSession.routine_id ?? routine?.id ?? null,
    extra: { ...(existingSession.extra || {}), routine_name: resolvedName },
    items: resolveRetroactiveItems(existingSession, exercises, workoutRecommendation, routine),
  }
}

function buildAddedExerciseItems(items: SessionItemPayload[], exercise: Exercise): SessionItemPayload[] {
  const newItem: SessionItemPayload = {
    id: newId(),
    exercise_id: exercise.id,
    position: items.length,
    notes: null,
    extra: {},
    sets: createSkippedSets(1),
  }
  return [...items, newItem]
}

function buildRemovedSetItems(items: SessionItemPayload[], itemIndex: number, setIndex: number): SessionItemPayload[] {
  return items.map((it, idx) =>
    idx === itemIndex
      ? { ...it, sets: it.sets.filter((_, j) => j !== setIndex).map((s, j) => ({ ...s, set_number: j + 1 })) }
      : it
  )
}

interface UseWorkoutSessionOptions {
  exercises: Exercise[]
  workoutRecommendation: WorkoutRecommendation | null
}

/**
 * Manages active and retroactive workout drafts in IndexedDB and provides set mutation helpers.
 */
export function useWorkoutSession({ exercises, workoutRecommendation }: UseWorkoutSessionOptions) {
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [isRetroactive, setIsRetroactive] = useState<boolean>(false)

  useEffect(() => {
    void db.drafts.get(DRAFT_KEY).then((draft) => {
      if (!draft) return
      setSession(draft.session)
      setIsRetroactive(Boolean(draft.isRetroactive))
    })
  }, [])

  const updateSession = useCallback(
    (next: SessionPayload | null, retroactiveOverride?: boolean) => {
      setSession(next)
      if (!next) {
        setIsRetroactive(false)
        void db.drafts.delete(DRAFT_KEY)
        return
      }
      const nextRetro = retroactiveOverride !== undefined ? retroactiveOverride : isRetroactive
      if (retroactiveOverride !== undefined) setIsRetroactive(retroactiveOverride)
      void db.drafts.put({ id: DRAFT_KEY, session: next, savedAt: Date.now(), isRetroactive: nextRetro })
    },
    [isRetroactive]
  )

  return {
    session,
    isRetroactive,
    updateSession,
    startSession: useCallback(
      (routine?: Routine) =>
        updateSession(buildNewSessionPayload(exercises, workoutRecommendation, routine), false),
      [exercises, workoutRecommendation, updateSession]
    ),
    editExistingSession: useCallback(
      (existingSession: SessionPayload, routine?: Routine) =>
        updateSession(buildRetroactivePayload(existingSession, exercises, workoutRecommendation, routine), true),
      [exercises, workoutRecommendation, updateSession]
    ),
    addExercise: useCallback(
      (exercise: Exercise) =>
        session && updateSession({ ...session, items: buildAddedExerciseItems(session.items, exercise) }),
      [session, updateSession]
    ),
    removeExercise: useCallback(
      (itemId: string) =>
        session && updateSession({ ...session, items: session.items.filter((it) => it.id !== itemId) }),
      [session, updateSession]
    ),
    addSet: useCallback(
      (itemIndex: number) =>
        session && updateSession({ ...session, items: buildAppendedSetItems(session.items, itemIndex) }),
      [session, updateSession]
    ),
    updateSet: useCallback(
      (itemIndex: number, setIndex: number, field: 'weight_kg' | 'reps', value: number | null) =>
        session &&
        updateSession({ ...session, items: buildUpdatedSetItems(session.items, itemIndex, setIndex, field, value) }),
      [session, updateSession]
    ),
    removeSet: useCallback(
      (itemIndex: number, setIndex: number) =>
        session && updateSession({ ...session, items: buildRemovedSetItems(session.items, itemIndex, setIndex) }),
      [session, updateSession]
    ),
  }
}
