import type { AccentVariant } from '@yggdrasil-lab/ui'
import type { DailyBiometrics, ReadinessTier, Routine, WorkoutRecommendation } from '../types'

export type { ReadinessTier }

export interface ReadinessStyleSpec {
  emoji: string
  textClass: string
  borderClass: string
  headerVariant: AccentVariant
}

export interface ReadinessSummary extends ReadinessStyleSpec {
  tier: ReadinessTier | 'unavailable'
  label: string
  message: string
}

export const READINESS_STYLE_MAP: Record<ReadinessTier, ReadinessStyleSpec> = {
  optimal: {
    emoji: '🟢',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
    headerVariant: 'emerald',
  },
  moderate: {
    emoji: '🟡',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    headerVariant: 'amber',
  },
  fatigued: {
    emoji: '🔴',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
    headerVariant: 'rose',
  },
}

const UNAVAILABLE_READINESS_SUMMARY: ReadinessSummary = {
  tier: 'unavailable',
  emoji: '⚪',
  label: 'Readiness Unavailable',
  textClass: 'text-slate-300',
  borderClass: 'border-slate-600/40',
  headerVariant: 'slate',
  message: 'Wearable readiness is currently unavailable. Listen to your body and train by feel.',
}

/**
 * Maps backend-computed daily readiness into UI presentation tokens, returning an explicit
 * neutral unavailable summary when Eir telemetry or backend readiness is absent.
 */
export function resolveReadinessSummary(biometrics: DailyBiometrics | null): ReadinessSummary {
  const backend = biometrics?.readiness
  if (!backend) return UNAVAILABLE_READINESS_SUMMARY

  const style = READINESS_STYLE_MAP[backend.tier]
  if (!style) return UNAVAILABLE_READINESS_SUMMARY

  return {
    tier: backend.tier,
    label: backend.label,
    message: backend.message,
    ...style,
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
