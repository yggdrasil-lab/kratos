import type { Routine, SessionPayload } from '../types'

/**
 * Returns a human-friendly, contextual workout title.
 * Prioritizes user overrides, then matched routine names, sport activity tags,
 * and circadian planned workout splits instead of generic fallbacks.
 */
export function getSessionLabel(s: SessionPayload, routines: Routine[] = []): string {
  const extra = s.extra || {}

  // 1. Explicit custom routine_name (ignore generic placeholder 'Gym Session' or 'Current Workout')
  if (typeof extra.routine_name === 'string' && extra.routine_name.trim()) {
    const trimmed = extra.routine_name.trim()
    if (trimmed.toLowerCase() !== 'gym session' && trimmed.toLowerCase() !== 'current workout') {
      return trimmed
    }
  }

  // 2. Explicit activity_name
  if (typeof extra.activity_name === 'string' && extra.activity_name.trim()) {
    const trimmed = extra.activity_name.trim()
    if (trimmed.toLowerCase() !== 'gym session' && trimmed.toLowerCase() !== 'current workout') {
      return trimmed
    }
  }

  // 3. Match against loaded routines by routine_id
  if (s.routine_id) {
    const routine = routines.find((r) => r.id === s.routine_id)
    if (routine?.name) return routine.name
  }

  // 4. Inferred / Sport context from weekday circadian plan
  const sessionDate = s.started_at ? new Date(s.started_at) : new Date()
  const dayOfWeek = sessionDate.getDay() // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

  if (extra.session_type === 'sport' || extra.sport) {
    return '🏸 Badminton Match Play'
  }

  // Auto-detected sessions from plan & wearable biometrics
  if (extra.inferred) {
    if (dayOfWeek === 1 || dayOfWeek === 3) {
      return '🏸 Badminton Match Play'
    } else if (dayOfWeek === 2) {
      return 'Lower Body A (Squat and Hinge)'
    } else if (dayOfWeek === 5) {
      return 'Upper Body B (Arms, Back and Delts)'
    } else if (dayOfWeek === 6) {
      return 'Lower Body B (Kettlebell, Lunge and Core)'
    } else if (dayOfWeek === 0) {
      return 'Upper Body A (Chest and Vertical Pull)'
    }
  }

  // 5. Fallback to day of week split if available
  if (dayOfWeek === 2) return 'Lower Body A'
  if (dayOfWeek === 5) return 'Upper Body B'
  if (dayOfWeek === 6) return 'Lower Body B'
  if (dayOfWeek === 0) return 'Upper Body A'
  if (dayOfWeek === 1 || dayOfWeek === 3) return '🏸 Badminton Match Play'

  // 6. If routine_name was explicitly set to something else
  if (typeof extra.routine_name === 'string' && extra.routine_name.trim()) {
    return extra.routine_name.trim()
  }

  return 'Gym Session'
}
