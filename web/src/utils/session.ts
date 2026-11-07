import type { Routine, SessionPayload } from '../types'

/**
 * Returns a human-friendly, contextual workout title.
 * Prioritizes user overrides, then matched routine names, sport activity tags,
 * and database-backed routine names instead of hardcoded split templates.
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

  // 4. Sport activity context
  if (extra.session_type === 'sport' || extra.sport) {
    if (typeof extra.sport_name === 'string' && extra.sport_name.trim()) {
      return extra.sport_name.trim()
    }
    return 'Sport Session'
  }

  // 5. Inferred session with routine metadata
  if (extra.inferred) {
    if (typeof extra.activity_name === 'string' && extra.activity_name.trim()) {
      return extra.activity_name.trim()
    }
    if (typeof extra.routine_name === 'string' && extra.routine_name.trim()) {
      return extra.routine_name.trim()
    }
  }

  // 6. Match by routine count or day if available in loaded routines
  if (routines.length > 0 && s.started_at) {
    const sessionDate = new Date(s.started_at)
    const dayOfWeek = (sessionDate.getDay() + 6) % 7 // Mon=0 .. Sun=6
    const matched = routines[dayOfWeek % routines.length]
    if (matched?.name) return matched.name
  }

  // 7. If routine_name was explicitly set to something else
  if (typeof extra.routine_name === 'string' && extra.routine_name.trim()) {
    return extra.routine_name.trim()
  }

  return 'Gym Session'
}
