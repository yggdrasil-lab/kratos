import type {
  ActivityType,
  EffortRating,
  Routine,
  SessionPayload,
  SplitSegmentInput,
  SuggestedSplitPoint,
  WorkoutRecommendation,
} from '../types'

export type SegmentMode = 'class' | 'cardio' | 'routine'

export interface SplitSegmentDraft {
  id: string
  startedAt: string
  endedAt: string
  mode: SegmentMode
  activityType: ActivityType
  routineId: string | null
  routineName: string
  effortRating: EffortRating | null
  notes: string
}

const CARDIO_DEFAULT_LABELS: Record<ActivityType, string> = {
  gym: 'Gym Session',
  class: 'Group Class',
  walk: 'Walk / Cardio',
  badminton: 'Badminton Match Play',
  swim: 'Swimming',
}

export function getDefaultLabelForActivity(activityType: ActivityType): string {
  return CARDIO_DEFAULT_LABELS[activityType] || 'Workout'
}

/**
 * Formats an ISO timestamp as local HH:MM for `<input type="time">` and badges.
 */
export function formatIsoToLocalHHMM(iso: string | null | undefined): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return ''
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

/**
 * Formats a start/end ISO pair into a compact local time range like "18:05-18:35".
 */
export function formatTimeRangeLabel(startedAt: string, endedAt: string | null): string {
  const startLabel = formatIsoToLocalHHMM(startedAt) || 'Unknown'
  const endLabel = formatIsoToLocalHHMM(endedAt)
  return endLabel ? `${startLabel}-${endLabel}` : startLabel
}

/**
 * Computes an effective ISO end timestamp for sessions missing `ended_at`.
 */
export function deriveDefaultEndIso(session: SessionPayload): string {
  if (session.ended_at) return session.ended_at
  const startMs = new Date(session.started_at).getTime()
  const mins =
    typeof session.extra?.duration_minutes === 'number' && session.extra.duration_minutes > 0
      ? session.extra.duration_minutes
      : 60
  return new Date(startMs + mins * 60_000).toISOString()
}

function buildDateWithHHMM(anchorIso: string, hhmm: string): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm.trim())
  const base = new Date(anchorIso)
  if (!match || Number.isNaN(base.getTime())) return null
  const out = new Date(base)
  out.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return out
}

/**
 * Resolves a local HH:MM input back to an ISO timestamp anchored to a session window,
 * handling late-night sessions that cross midnight cleanly.
 */
export function resolveBoundaryIsoWithinWindow(
  parentStartIso: string,
  parentEndIso: string,
  hhmm: string
): string | null {
  const startDt = buildDateWithHHMM(parentStartIso, hhmm)
  const endDt = buildDateWithHHMM(parentEndIso, hhmm)
  if (!startDt || !endDt) return null

  const pStartMs = new Date(parentStartIso).getTime()
  const pEndMs = new Date(parentEndIso).getTime()
  if (startDt.getTime() === endDt.getTime()) return startDt.toISOString()

  const startInRange = startDt.getTime() >= pStartMs && startDt.getTime() <= pEndMs
  const endInRange = endDt.getTime() >= pStartMs && endDt.getTime() <= pEndMs
  if (startInRange && !endInRange) return startDt.toISOString()
  if (endInRange && !startInRange) return endDt.toISOString()

  const distStart = Math.abs(startDt.getTime() - pStartMs)
  const distEnd = Math.abs(endDt.getTime() - pEndMs)
  return (distStart <= distEnd ? startDt : endDt).toISOString()
}

/**
 * Resolves edited Start and End HH:MM inputs for a single session date, handling midnight wrap.
 */
export function resolveEditedSessionTimestamps(
  baseStartedAt: string,
  baseEndedAt: string | null,
  startHHMM: string,
  endHHMM: string
): { startedAt: string; endedAt: string } | null {
  const startDt = buildDateWithHHMM(baseStartedAt, startHHMM)
  const endDt = buildDateWithHHMM(baseStartedAt, endHHMM)
  if (!startDt || !endDt) return null

  const hadMidnightRollover =
    Boolean(baseEndedAt) &&
    new Date(baseEndedAt as string).getDate() !== new Date(baseStartedAt).getDate()
  if (endDt.getTime() <= startDt.getTime() && (hadMidnightRollover || startDt.getHours() >= 20)) {
    endDt.setDate(endDt.getDate() + 1)
  }
  if (endDt.getTime() <= startDt.getTime()) return null
  return { startedAt: startDt.toISOString(), endedAt: endDt.toISOString() }
}

function findInitialRoutine(
  parentSession: SessionPayload,
  routines: Routine[],
  workoutRecommendation: WorkoutRecommendation | null
): Routine | null {
  if (parentSession.routine_id) {
    const byId = routines.find((r) => r.id === parentSession.routine_id)
    if (byId) return byId
  }
  const recName = workoutRecommendation?.routine_name?.toLowerCase()
  if (recName) {
    const matched = routines.find((r) => r.name.toLowerCase() === recName)
    if (matched) return matched
  }
  return routines.find((r) => r.items.length > 0) || routines[0] || null
}

function snapMidpointIso(startIso: string, endIso: string): string {
  const startMs = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  const rawMid = startMs + (endMs - startMs) / 2
  const fiveMin = 5 * 60_000
  const snapped = Math.round(rawMid / fiveMin) * fiveMin
  const bounded = Math.min(endMs - 60_000, Math.max(startMs + 60_000, snapped))
  return new Date(bounded).toISOString()
}

/**
 * Seeds two chronological gap-ready split segments from an inferred or confirmed session.
 */
export function createInitialSplitSegments(
  parentSession: SessionPayload,
  routines: Routine[],
  workoutRecommendation: WorkoutRecommendation | null
): SplitSegmentDraft[] {
  const parentStart = parentSession.started_at
  const parentEnd = deriveDefaultEndIso(parentSession)
  const splitIso = snapMidpointIso(parentStart, parentEnd)
  const defaultRoutine = findInitialRoutine(parentSession, routines, workoutRecommendation)

  return [
    {
      id: 'seg-1',
      startedAt: parentStart,
      endedAt: splitIso,
      mode: 'class',
      activityType: 'class',
      routineId: null,
      routineName: 'Group Core',
      effortRating: null,
      notes: '',
    },
    {
      id: 'seg-2',
      startedAt: splitIso,
      endedAt: parentEnd,
      mode: defaultRoutine ? 'routine' : 'cardio',
      activityType: 'gym',
      routineId: defaultRoutine ? defaultRoutine.id : null,
      routineName: defaultRoutine ? defaultRoutine.name : 'Resistance Training',
      effortRating: null,
      notes: '',
    },
  ]
}

/**
 * Applies a suggested split boundary from Eir's timeline onto the first two segments.
 */
export function applySuggestedSplitToSegments(
  segments: SplitSegmentDraft[],
  split: SuggestedSplitPoint
): SplitSegmentDraft[] {
  if (segments.length < 2) return segments
  return segments.map((seg, idx) => {
    if (idx === 0) return { ...seg, endedAt: split.split_at }
    if (idx === 1) return { ...seg, startedAt: split.resume_at }
    return seg
  })
}

/**
 * Splits the final segment in half to add a 3rd or 4th segment (max 4).
 */
export function appendSegmentBySplittingLast(segments: SplitSegmentDraft[]): SplitSegmentDraft[] {
  if (segments.length >= 4 || segments.length === 0) return segments
  const last = segments[segments.length - 1]
  const startMs = new Date(last.startedAt).getTime()
  const endMs = new Date(last.endedAt).getTime()
  if (endMs - startMs < 120_000) return segments

  const midIso = snapMidpointIso(last.startedAt, last.endedAt)
  const nextId = `seg-${Date.now()}`
  return [
    ...segments.slice(0, -1),
    { ...last, endedAt: midIso },
    {
      id: nextId,
      startedAt: midIso,
      endedAt: last.endedAt,
      mode: 'cardio',
      activityType: 'walk',
      routineId: null,
      routineName: 'Cooldown Walk',
      effortRating: null,
      notes: '',
    },
  ]
}

/**
 * Validates segment count (2-4), strictly positive durations, and non-overlapping order.
 */
export function validateSplitDrafts(segments: SplitSegmentDraft[]): string | null {
  if (segments.length < 2 || segments.length > 4) {
    return 'Split must contain between 2 and 4 segments.'
  }
  for (let idx = 0; idx < segments.length; idx += 1) {
    const startMs = new Date(segments[idx].startedAt).getTime()
    const endMs = new Date(segments[idx].endedAt).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) {
      return `Segment ${idx + 1} end time must be after its start time.`
    }
    if (idx < segments.length - 1) {
      const nextStartMs = new Date(segments[idx + 1].startedAt).getTime()
      if (endMs > nextStartMs) {
        return `Segment ${idx + 1} overlaps Segment ${idx + 2}. Gaps are allowed, overlaps are not.`
      }
    }
  }
  return null
}

/**
 * Converts UI segment drafts into the API payload for `POST /sessions/{id}/split`.
 */
export function toSplitSegmentInputs(segments: SplitSegmentDraft[]): SplitSegmentInput[] {
  return segments.map((seg) => ({
    started_at: seg.startedAt,
    ended_at: seg.endedAt,
    routine_id: seg.mode === 'routine' ? seg.routineId : null,
    routine_name: seg.routineName.trim() || getDefaultLabelForActivity(seg.activityType),
    activity_type: seg.mode === 'class' ? 'class' : seg.mode === 'routine' ? 'gym' : seg.activityType,
    classification: seg.mode === 'class' ? 'class' : seg.mode === 'routine' ? 'gym' : seg.activityType,
    effort_rating: seg.effortRating,
    notes: seg.notes.trim() || null,
  }))
}
