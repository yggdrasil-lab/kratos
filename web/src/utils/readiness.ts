import type { DailyBiometrics, Routine, WorkoutRecommendation } from '../types'

export type ReadinessTier = 'optimal' | 'moderate' | 'fatigued'

export interface ReadinessSummary {
  tier: ReadinessTier
  emoji: string
  label: string
  textClass: string
  borderClass: string
  message: string
}

/**
 * Derives daily recovery tier and styling metadata from wearable sleep and HRV metrics.
 */
export function computeReadinessTier(biometrics: DailyBiometrics | null): ReadinessSummary {
  const sleepHours = biometrics?.sleep_duration_hours ?? null
  const hrvMs = biometrics?.hrv_ms ? Number(biometrics.hrv_ms) : null

  if (sleepHours !== null && sleepHours < 5.5) {
    return {
      tier: 'fatigued',
      emoji: '🔴',
      label: 'Low Recovery',
      textClass: 'text-rose-400',
      borderClass: 'border-rose-500/30',
      message: 'Short sleep detected (<5.5h). Recommend volume scaling or posture mobility.',
    }
  }

  if ((sleepHours !== null && sleepHours < 6.8) || (hrvMs !== null && hrvMs < 42)) {
    return {
      tier: 'moderate',
      emoji: '🟡',
      label: 'Moderate Fatigue',
      textClass: 'text-amber-400',
      borderClass: 'border-amber-500/30',
      message: 'Moderate recovery. Keep form tight and cap intensity around RPE 7-8.',
    }
  }

  return {
    tier: 'optimal',
    emoji: '🟢',
    label: 'High Readiness',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
    message: 'Optimal state. Prime day to push progressive overload and PRs.',
  }
}

export interface TodayRoutineResolution {
  matchedRecommendedRoutine: Routine | null
  defaultRoutine: Routine | null
  activeRoutine: Routine | null
  dayHeadline: string
  daySubtitle: string
}

/**
 * Matches today's workout recommendation against database routines without falling back
 * to resistance splits on scheduled sport or rest days unless explicitly overridden.
 */
export function resolveTodayRoutineState(
  routines: Routine[],
  workoutRecommendation?: WorkoutRecommendation | null,
  selectedRoutineOverride?: Routine | null
): TodayRoutineResolution {
  const recommendedName = workoutRecommendation?.routine_name
  const matchedRecommendedRoutine = recommendedName
    ? routines.find((r) => r.name.toLowerCase() === recommendedName.toLowerCase()) || null
    : null

  const hasRecommendedExercises = Boolean(
    workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0
  )

  const defaultRoutine: Routine | null =
    matchedRecommendedRoutine &&
    matchedRecommendedRoutine.items &&
    matchedRecommendedRoutine.items.length > 0 &&
    (!workoutRecommendation || hasRecommendedExercises)
      ? matchedRecommendedRoutine
      : null

  const activeRoutine = selectedRoutineOverride || defaultRoutine

  const dayHeadline = selectedRoutineOverride
    ? selectedRoutineOverride.name
    : workoutRecommendation?.routine_name || activeRoutine?.name || 'Rest & Recovery'

  let daySubtitle = 'No routines scheduled for today'
  if (selectedRoutineOverride) {
    daySubtitle =
      selectedRoutineOverride.items && selectedRoutineOverride.items.length > 0
        ? `${selectedRoutineOverride.items.length} exercises configured`
        : 'No exercises configured'
  } else if (hasRecommendedExercises && workoutRecommendation) {
    daySubtitle = `${workoutRecommendation.exercises.length} autoregulated exercises`
  } else if (activeRoutine?.items && activeRoutine.items.length > 0) {
    daySubtitle = `${activeRoutine.items.length} exercises configured`
  }

  return {
    matchedRecommendedRoutine,
    defaultRoutine,
    activeRoutine,
    dayHeadline,
    daySubtitle,
  }
}
