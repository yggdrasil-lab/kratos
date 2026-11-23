import type { Exercise, SessionPayload } from '../types'
import { getCircadianDate } from './circadian'
import { computeSessionVolumeAndSets } from './session'

export interface GhostTarget {
  weightKg: number | null
  reps: number | null
}

/**
 * Finds the heaviest completed set for an exercise across historical sessions.
 */
export function getExerciseGhostTarget(
  exerciseId: string,
  sessions: SessionPayload[]
): GhostTarget | null {
  for (const sess of sessions) {
    const matchItem = sess.items.find((it) => it.exercise_id === exerciseId)
    if (!matchItem) continue

    const doneSets = matchItem.sets.filter(
      (s) => s.status === 'done' && (s.weight_kg !== null || s.reps !== null)
    )
    if (doneSets.length === 0) continue

    const heaviest = [...doneSets].sort((a, b) => (b.weight_kg ?? 0) - (a.weight_kg ?? 0))[0]
    return {
      weightKg: heaviest.weight_kg,
      reps: heaviest.reps,
    }
  }
  return null
}

/**
 * Computes a Monday-to-Sunday boolean attendance array for the current week.
 */
export function computeWeeklyRhythm(
  sessions: SessionPayload[],
  dayOfWeek: number,
  referenceDate: Date = new Date()
): boolean[] {
  const weekDaySessions: boolean[] = [false, false, false, false, false, false, false]
  const monday = new Date(referenceDate)
  monday.setDate(referenceDate.getDate() - dayOfWeek)
  monday.setHours(0, 0, 0, 0)

  for (const s of sessions) {
    const sDate = new Date(s.started_at)
    const diffDays = Math.floor((sDate.getTime() - monday.getTime()) / (24 * 3600 * 1000))
    if (diffDays >= 0 && diffDays < 7) {
      weekDaySessions[diffDays] = true
    }
  }

  return weekDaySessions
}

/**
 * Returns true if a session timestamp matches the provided circadian date (YYYY-MM-DD).
 */
export function isSessionOnCircadianDate(
  session: SessionPayload,
  circadianDate: string
): boolean {
  const timeStr = session.started_at || session.ended_at
  if (!timeStr) return false

  const sDate = new Date(timeStr)
  if (isNaN(sDate.getTime())) return false

  const sessionCircadian = getCircadianDate(sDate)
  const sessionLocal = `${sDate.getFullYear()}-${String(sDate.getMonth() + 1).padStart(2, '0')}-${String(sDate.getDate()).padStart(2, '0')}`
  const rawDatePrefix = timeStr.split('T')[0]

  return (
    sessionCircadian === circadianDate ||
    sessionLocal === circadianDate ||
    rawDatePrefix === circadianDate
  )
}

/**
 * Returns true when a session represents a manually completed (non-inferred) workout.
 */
export function isCompletedWorkoutSession(session: SessionPayload): boolean {
  if (session.extra?.inferred) return false
  if (session.ended_at) return true
  if (session.extra?.completed) return true
  return Boolean(
    session.items && session.items.some((it) => it.sets && it.sets.some((st) => st.status === 'done'))
  )
}

/**
 * Computes workout duration in minutes from start/end timestamps or extra metadata.
 */
export function getSessionDurationMinutes(session: SessionPayload): number | null {
  if (session.ended_at && session.started_at) {
    return Math.max(
      1,
      Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000)
    )
  }
  if (typeof session.extra?.duration_minutes === 'number') {
    return session.extra.duration_minutes
  }
  return null
}

/**
 * Resolves an exercise display name from the cached catalogue.
 */
export function getExerciseDisplayName(
  exerciseId: string,
  exercises: Pick<Exercise, 'id' | 'name'>[]
): string {
  const ex = exercises.find((e) => e.id === exerciseId)
  return ex ? ex.name : 'Exercise'
}

export interface TodayCompletedSummary {
  completedSessions: SessionPayload[]
  classSessions: SessionPayload[]
  primarySessions: SessionPayload[]
  latestSession: SessionPayload | null
  hasCompletedToday: boolean
  hasCompletedPrimaryToday: boolean
  totalDurationMins: number
  totalSets: number
  totalVolumeKg: number
}

const CLASS_LABEL_PATTERN =
  /(\bclass\b|\bgroup\b|\bcore\b|\bpilates\b|\byoga\b|\bspin\b|\bcycle\b|\bhiit\b|\bboxing\b|\bpump\b)/i

/**
 * Returns true when a confirmed session is a gym class rather than a scheduled strength lift.
 */
export function isClassWorkoutSession(session: SessionPayload): boolean {
  const activityType =
    typeof session.extra?.activity_type === 'string'
      ? session.extra.activity_type.trim().toLowerCase()
      : ''
  const classification =
    typeof session.extra?.classification === 'string'
      ? session.extra.classification.trim().toLowerCase()
      : ''
  if (activityType === 'class' || classification === 'class') {
    return true
  }
  if (!session.routine_id && (session.items?.length ?? 0) === 0) {
    const rawName =
      (typeof session.extra?.routine_name === 'string' && session.extra.routine_name) ||
      (typeof session.extra?.activity_name === 'string' && session.extra.activity_name) ||
      ''
    return CLASS_LABEL_PATTERN.test(rawName)
  }
  return false
}

/**
 * Aggregates completed workout sessions, separating class-only workouts from primary training.
 */
export function getCompletedTodaySummary(
  sessions: SessionPayload[],
  exercises: Exercise[],
  circadianDate: string
): TodayCompletedSummary {
  const completedSessions = sessions
    .filter((s) => isCompletedWorkoutSession(s) && isSessionOnCircadianDate(s, circadianDate))
    .sort(
      (a, b) =>
        new Date(b.started_at || b.ended_at || 0).getTime() -
        new Date(a.started_at || a.ended_at || 0).getTime()
    )

  const classSessions = completedSessions.filter((s) => isClassWorkoutSession(s))
  const primarySessions = completedSessions.filter((s) => !isClassWorkoutSession(s))
  const metricSource = primarySessions.length > 0 ? primarySessions : completedSessions

  let totalDurationMins = 0
  let totalSets = 0
  let totalVolumeKg = 0

  for (const s of metricSource) {
    let { volume, sets } = computeSessionVolumeAndSets(s, exercises)
    if (sets === 0 && typeof s.extra?.completed_sets === 'number') {
      sets = s.extra.completed_sets
    }
    if (volume === 0 && typeof s.extra?.total_volume_kg === 'number') {
      volume = s.extra.total_volume_kg
    }
    const duration = getSessionDurationMinutes(s)

    totalDurationMins += duration || 0
    totalSets += sets
    totalVolumeKg += volume
  }

  return {
    completedSessions,
    classSessions,
    primarySessions,
    latestSession: primarySessions[0] || completedSessions[0] || null,
    hasCompletedToday: completedSessions.length > 0,
    hasCompletedPrimaryToday: primarySessions.length > 0,
    totalDurationMins,
    totalSets,
    totalVolumeKg,
  }
}
