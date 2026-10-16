import { useState, useEffect } from 'react'
import type { DayScheduleConfig, PlannedActivity, Routine, SessionPayload, WeekDayPlan } from '../types'

interface WeekViewProps {
  routines: Routine[]
  sessions: SessionPayload[]
  onStartRoutine: (routine: Routine) => void
  onSaveSession: (session: SessionPayload) => Promise<void>
  onDeleteSession: (sessionId: string) => Promise<void>
}

const STORAGE_KEY_OVERRIDES = 'kratos_weekly_plan_overrides'
const STORAGE_KEY_EXTRA_ACTIVITIES = 'kratos_extra_activities'

const DEFAULT_SCHEDULE_CONFIG: DayScheduleConfig[] = [
  {
    sessionName: 'Lower Body A',
    type: 'lift',
    emphasis: 'Squat emphasis • 4 exercises × 2 sets to failure',
    notes: 'Goblet Squat (depth > weight), DB Deadlift, Calf Raise, Plank',
  },
  {
    sessionName: 'Badminton',
    type: 'sport',
    emphasis: '7:00 PM – 9:00 PM • Fixed court session',
    notes: 'Fixed sport session. High intensity cardio & agility. No lifting.',
  },
  {
    sessionName: 'Upper Body A',
    type: 'lift',
    emphasis: 'Push emphasis • 4 exercises × 2 sets to failure',
    notes: 'Incline DB Bench, Overhead Press, Seated Machine Row, Cable Face Pull',
  },
  {
    sessionName: 'Badminton',
    type: 'sport',
    emphasis: '7:00 PM – 9:00 PM • Fixed court session',
    notes: 'Fixed sport session. High intensity cardio & agility. No lifting.',
  },
  {
    sessionName: 'Rest + Long Fast',
    type: 'rest',
    emphasis: 'Full recovery & long fast window (18–24h)',
    notes: 'No training. Fasting protocol per Health vault guide.',
  },
  {
    sessionName: 'Lower Body B',
    type: 'lift',
    emphasis: 'Hinge emphasis • 4 exercises × 2 sets to failure',
    notes: 'Primary DB Deadlift, Bodyweight Lunge, Lying Leg Curl, Leg Extension',
  },
  {
    sessionName: 'Upper Body B',
    type: 'lift',
    emphasis: 'Pull emphasis • 4 exercises × 2 sets to failure',
    notes: 'Wide Lat Pulldown, DB Bench Press, Bent-Over One Arm Row, Triceps Pushdown',
  },
]

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const SPORT_PRESETS = [
  'Badminton',
  'Running',
  'Swimming',
  'Cycling',
  'Tennis',
  'Squash',
  'Basketball',
  'Climbing',
  'Yoga',
]

function loadPlanOverrides(): Record<number, DayScheduleConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OVERRIDES)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function savePlanOverrides(overrides: Record<number, DayScheduleConfig>) {
  try {
    localStorage.setItem(STORAGE_KEY_OVERRIDES, JSON.stringify(overrides))
  } catch {
    // ignore
  }
}

function loadExtraActivities(): Record<string, PlannedActivity[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXTRA_ACTIVITIES)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveExtraActivities(extras: Record<string, PlannedActivity[]>) {
  try {
    localStorage.setItem(STORAGE_KEY_EXTRA_ACTIVITIES, JSON.stringify(extras))
  } catch {
    // ignore
  }
}

export function getCurrentWeekPlan(): WeekDayPlan[] {
  const now = new Date()
  const dayIndex = (now.getDay() + 6) % 7 // Monday = 0
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayIndex)
  monday.setHours(0, 0, 0, 0)

  const overrides = loadPlanOverrides()
  const extras = loadExtraActivities()

  return DEFAULT_SCHEDULE_CONFIG.map((defaultConfig, idx) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + idx)
    const isToday = d.toDateString() === now.toDateString()
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dateStr = `${d.getDate()} ${MONTHS[d.getMonth()]}`

    const config = overrides[idx] || defaultConfig
    const dayExtras = extras[isoDate] || []

    return {
      dayIndex: idx,
      dayName: DAY_NAMES[idx],
      dayShort: DAY_SHORTS[idx],
      sessionName: config.sessionName,
      type: config.type,
      emphasis: config.emphasis,
      notes: config.notes,
      extraActivities: dayExtras,
      dateStr,
      isoDate,
      isToday,
    }
  })
}

export function WeekView({
  routines,
  sessions,
  onStartRoutine,
  onSaveSession,
  onDeleteSession,
}: WeekViewProps) {
  const [weekPlan, setWeekPlan] = useState<WeekDayPlan[]>(() => getCurrentWeekPlan())
  const [editingDay, setEditingDay] = useState<WeekDayPlan | null>(null)
  const [editSessionName, setEditSessionName] = useState('')
  const [editType, setEditType] = useState<'lift' | 'sport' | 'rest'>('lift')
  const [editEmphasis, setEditEmphasis] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // Modal for adding unplanned / additional sport activity
  const [addingActivityDay, setAddingActivityDay] = useState<WeekDayPlan | null>(null)
  const [activityName, setActivityName] = useState('')
  const [activityType, setActivityType] = useState<'sport' | 'lift'>('sport')
  const [activityStatus, setActivityStatus] = useState<'completed' | 'skipped' | 'planned'>('completed')
  const [activityDuration, setActivityDuration] = useState('')
  const [activityNotes, setActivityNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const refreshWeekPlan = () => {
    setWeekPlan(getCurrentWeekPlan())
  }

  useEffect(() => {
    refreshWeekPlan()
  }, [sessions])

  const mondayDate = weekPlan[0]?.dateStr ?? ''
  const sundayDate = weekPlan[6]?.dateStr ?? ''

  // Open edit day modal
  const openEditDayModal = (day: WeekDayPlan) => {
    setEditingDay(day)
    setEditSessionName(day.sessionName)
    setEditType(day.type)
    setEditEmphasis(day.emphasis)
    setEditNotes(day.notes || '')
  }

  const handleSaveDayEdit = () => {
    if (!editingDay) return
    const overrides = loadPlanOverrides()
    overrides[editingDay.dayIndex] = {
      sessionName: editSessionName.trim() || editingDay.sessionName,
      type: editType,
      emphasis: editEmphasis.trim(),
      notes: editNotes.trim() || undefined,
    }
    savePlanOverrides(overrides)
    setEditingDay(null)
    refreshWeekPlan()
  }

  const handleResetDayToDefault = () => {
    if (!editingDay) return
    const overrides = loadPlanOverrides()
    delete overrides[editingDay.dayIndex]
    savePlanOverrides(overrides)
    setEditingDay(null)
    refreshWeekPlan()
  }

  // Open add unplanned / custom activity modal
  const openAddActivityModal = (day: WeekDayPlan) => {
    setAddingActivityDay(day)
    setActivityName('')
    setActivityType('sport')
    setActivityStatus('completed')
    setActivityDuration('')
    setActivityNotes('')
  }

  const handleSaveNewActivity = async () => {
    if (!addingActivityDay || !activityName.trim()) return
    setIsSubmitting(true)
    const name = activityName.trim()

    try {
      if (activityStatus === 'completed' || activityStatus === 'skipped') {
        const newSession: SessionPayload = {
          id: crypto.randomUUID(),
          routine_id: null,
          started_at: `${addingActivityDay.isoDate}T12:00:00.000Z`,
          ended_at: activityStatus === 'completed' ? `${addingActivityDay.isoDate}T13:00:00.000Z` : null,
          notes: activityNotes.trim() || null,
          extra: {
            session_type: activityType,
            activity_name: name,
            status: activityStatus,
            is_unplanned: true,
            duration_minutes: activityDuration ? parseInt(activityDuration, 10) : null,
          },
          items: [],
        }
        await onSaveSession(newSession)
      } else {
        // Save as planned activity in extra activities
        const extras = loadExtraActivities()
        const list = extras[addingActivityDay.isoDate] || []
        list.push({
          id: crypto.randomUUID(),
          name,
          type: activityType,
          emphasis: activityDuration ? `${activityDuration} min` : undefined,
          notes: activityNotes.trim() || undefined,
          durationMinutes: activityDuration ? parseInt(activityDuration, 10) : undefined,
          isUnplanned: true,
        })
        extras[addingActivityDay.isoDate] = list
        saveExtraActivities(extras)
      }

      setAddingActivityDay(null)
      refreshWeekPlan()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemovePlannedExtraActivity = (isoDate: string, actId: string) => {
    const extras = loadExtraActivities()
    if (extras[isoDate]) {
      extras[isoDate] = extras[isoDate].filter((a) => a.id !== actId)
      saveExtraActivities(extras)
      refreshWeekPlan()
    }
  }

  // Helper: Find sessions for a given date
  const getDaySessions = (isoDate: string) => {
    return sessions.filter((s) => s.started_at && s.started_at.slice(0, 10) === isoDate)
  }

  // Log sport attendance
  const handleLogSportAttendance = async (day: WeekDayPlan, actName: string) => {
    setIsSubmitting(true)
    try {
      const newSession: SessionPayload = {
        id: crypto.randomUUID(),
        routine_id: null,
        started_at: `${day.isoDate}T19:00:00.000Z`,
        ended_at: `${day.isoDate}T21:00:00.000Z`,
        notes: null,
        extra: {
          session_type: 'sport',
          activity_name: actName,
          status: 'completed',
        },
        items: [],
      }
      await onSaveSession(newSession)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Log sport skipped
  const handleLogSportSkipped = async (day: WeekDayPlan, actName: string) => {
    setIsSubmitting(true)
    try {
      const newSession: SessionPayload = {
        id: crypto.randomUUID(),
        routine_id: null,
        started_at: `${day.isoDate}T19:00:00.000Z`,
        ended_at: null,
        notes: 'Skipped planned sport activity',
        extra: {
          session_type: 'sport',
          activity_name: actName,
          status: 'skipped',
        },
        items: [],
      }
      await onSaveSession(newSession)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Log workout skipped
  const handleLogWorkoutSkipped = async (day: WeekDayPlan, matchingRoutine?: Routine) => {
    setIsSubmitting(true)
    try {
      const newSession: SessionPayload = {
        id: crypto.randomUUID(),
        routine_id: matchingRoutine?.id || null,
        started_at: `${day.isoDate}T12:00:00.000Z`,
        ended_at: null,
        notes: 'Skipped planned workout for the day',
        extra: {
          session_type: 'lift',
          routine_name: day.sessionName,
          status: 'skipped',
        },
        items: [],
      }
      await onSaveSession(newSession)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="animate-slide-up">
      <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Weekly Schedule</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {mondayDate} – {sundayDate} • Periodized around badminton & fasting
          </p>
        </div>
      </div>

      <div className="flex-col" style={{ gap: '0.9rem' }}>
        {weekPlan.map((day) => {
          const daySessions = getDaySessions(day.isoDate)

          // Primary workout/sport match
          const matchingRoutine = routines.find(
            (r) => r.name.toLowerCase().trim() === day.sessionName.toLowerCase().trim()
          )

          // Check completed lift session
          const completedLiftSession = daySessions.find(
            (s) =>
              s.extra?.status !== 'skipped' &&
              ((s.extra?.routine_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                s.items.length > 0 ||
                s.extra?.session_type === 'lift')
          )

          // Check skipped lift session
          const skippedLiftSession = daySessions.find(
            (s) =>
              s.extra?.status === 'skipped' &&
              ((s.extra?.routine_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                s.extra?.session_type === 'lift')
          )

          // Check sport attended session
          const attendedSportSession = daySessions.find(
            (s) =>
              s.extra?.status === 'completed' &&
              ((s.extra?.activity_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                s.extra?.session_type === 'sport')
          )

          // Check sport skipped session
          const skippedSportSession = daySessions.find(
            (s) =>
              s.extra?.status === 'skipped' &&
              ((s.extra?.activity_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                s.extra?.session_type === 'sport')
          )

          // Separate out unplanned/additional sessions for this day
          const additionalLoggedSessions = daySessions.filter((s) => {
            if (s.id === completedLiftSession?.id) return false
            if (s.id === skippedLiftSession?.id) return false
            if (s.id === attendedSportSession?.id) return false
            if (s.id === skippedSportSession?.id) return false
            return true
          })

          return (
            <div
              key={day.isoDate}
              className={`glass-panel week-card ${day.isToday ? 'week-card-today' : ''}`}
              style={{
                margin: 0,
                padding: '1.1rem 1.25rem',
                borderColor: day.isToday ? 'var(--primary-color)' : undefined,
                background: day.isToday ? 'rgba(59, 130, 246, 0.08)' : undefined,
              }}
            >
              {/* Header bar of day card */}
              <div className="flex-between" style={{ alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div className="flex-row" style={{ gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      color: day.isToday ? 'var(--primary-hover)' : 'var(--text-secondary)',
                      minWidth: '3.2rem',
                    }}
                  >
                    {day.dayShort} {day.dateStr}
                  </span>
                  {day.isToday && <span className="badge-today">Today</span>}

                  {/* Status badges for primary day activity */}
                  {day.type === 'lift' && completedLiftSession && (
                    <span className="badge-completed">✓ Completed</span>
                  )}
                  {day.type === 'lift' && !completedLiftSession && skippedLiftSession && (
                    <span className="badge-missed">✕ Skipped</span>
                  )}
                  {day.type === 'sport' && attendedSportSession && (
                    <span className="badge-completed">✓ Attended</span>
                  )}
                  {day.type === 'sport' && !attendedSportSession && skippedSportSession && (
                    <span className="badge-missed">✕ Skipped</span>
                  )}
                </div>

                <div className="flex-row" style={{ gap: '0.4rem', alignItems: 'center' }}>
                  <button
                    className="btn-icon btn-secondary"
                    title="Edit this day's plan"
                    onClick={() => openEditDayModal(day)}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                  >
                    ✎ Edit
                  </button>
                  <span className={`type-tag type-${day.type}`}>
                    {day.type === 'lift' ? '🏋️ Lift' : day.type === 'sport' ? '🏸 Sport' : '☕ Rest & Fast'}
                  </span>
                </div>
              </div>

              {/* Primary Activity Info & Actions */}
              <div className="flex-between" style={{ alignItems: 'center', marginTop: '0.4rem', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#fff', marginBottom: '0.2rem' }}>
                    {day.sessionName}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', opacity: 0.9, margin: 0 }}>
                    {day.emphasis}
                  </p>
                  {day.notes && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', marginBottom: 0 }}>
                      {day.notes}
                    </p>
                  )}
                </div>

                {/* Action buttons based on day type */}
                <div className="flex-row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Lift Day Actions */}
                  {day.type === 'lift' && (
                    <>
                      {matchingRoutine && (
                        <button
                          className="btn-primary"
                          style={{
                            padding: '0.55rem 0.95rem',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap',
                          }}
                          onClick={() => onStartRoutine(matchingRoutine)}
                        >
                          {completedLiftSession ? 'Re-run' : 'Start'} Workout
                        </button>
                      )}
                      {!completedLiftSession && !skippedLiftSession && (
                        <button
                          className="btn-secondary"
                          style={{
                            padding: '0.55rem 0.85rem',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap',
                            color: 'var(--text-secondary)',
                          }}
                          disabled={isSubmitting}
                          onClick={() => handleLogWorkoutSkipped(day, matchingRoutine)}
                        >
                          Skip
                        </button>
                      )}
                      {skippedLiftSession && (
                        <button
                          className="btn-secondary"
                          style={{
                            padding: '0.55rem 0.85rem',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap',
                          }}
                          disabled={isSubmitting}
                          onClick={() => onDeleteSession(skippedLiftSession.id)}
                        >
                          Undo Skip
                        </button>
                      )}
                    </>
                  )}

                  {/* Sport Day Actions */}
                  {day.type === 'sport' && (
                    <>
                      {!attendedSportSession && !skippedSportSession && (
                        <>
                          <button
                            className="btn-primary"
                            style={{
                              padding: '0.55rem 0.85rem',
                              fontSize: '0.85rem',
                              whiteSpace: 'nowrap',
                            }}
                            disabled={isSubmitting}
                            onClick={() => handleLogSportAttendance(day, day.sessionName)}
                          >
                            ✓ Attended
                          </button>
                          <button
                            className="btn-secondary"
                            style={{
                              padding: '0.55rem 0.85rem',
                              fontSize: '0.85rem',
                              whiteSpace: 'nowrap',
                              color: 'var(--text-secondary)',
                            }}
                            disabled={isSubmitting}
                            onClick={() => handleLogSportSkipped(day, day.sessionName)}
                          >
                            ✕ Skipped
                          </button>
                        </>
                      )}
                      {attendedSportSession && (
                        <button
                          className="btn-secondary"
                          style={{
                            padding: '0.55rem 0.85rem',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap',
                          }}
                          disabled={isSubmitting}
                          onClick={() => onDeleteSession(attendedSportSession.id)}
                        >
                          Undo Attended
                        </button>
                      )}
                      {skippedSportSession && (
                        <button
                          className="btn-secondary"
                          style={{
                            padding: '0.55rem 0.85rem',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap',
                          }}
                          disabled={isSubmitting}
                          onClick={() => onDeleteSession(skippedSportSession.id)}
                        >
                          Undo Skip
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Extra / Unplanned Activities on this Day */}
              {(additionalLoggedSessions.length > 0 || (day.extraActivities && day.extraActivities.length > 0)) && (
                <div
                  style={{
                    marginTop: '0.85rem',
                    paddingTop: '0.8rem',
                    borderTop: '1px dashed var(--surface-border)',
                  }}
                >
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Additional & Unplanned Activities:
                  </span>
                  <div className="flex-col" style={{ gap: '0.45rem', marginTop: '0.4rem' }}>
                    {/* Logged extra sessions */}
                    {additionalLoggedSessions.map((extra) => {
                      const actName = (extra.extra?.activity_name as string) || (extra.extra?.routine_name as string) || 'Activity'
                      const isSkipped = extra.extra?.status === 'skipped'
                      const isAttended = extra.extra?.status === 'completed'
                      const duration = extra.extra?.duration_minutes

                      return (
                        <div
                          key={extra.id}
                          className="flex-between"
                          style={{
                            fontSize: '0.85rem',
                            background: 'rgba(255, 255, 255, 0.04)',
                            padding: '0.45rem 0.75rem',
                            borderRadius: '6px',
                          }}
                        >
                          <div className="flex-row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                            <span>🏅 {actName}</span>
                            {duration && <span className="badge-duration">⏱ {duration}m</span>}
                            {isAttended && <span className="badge-completed">✓ Attended</span>}
                            {isSkipped && <span className="badge-missed">✕ Skipped</span>}
                          </div>
                          <button
                            className="btn-icon btn-secondary"
                            title="Remove this entry"
                            onClick={() => onDeleteSession(extra.id)}
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}

                    {/* Planned extra activities from localStorage */}
                    {day.extraActivities?.map((planAct) => (
                      <div
                        key={planAct.id}
                        className="flex-between"
                        style={{
                          fontSize: '0.85rem',
                          background: 'rgba(255, 255, 255, 0.03)',
                          padding: '0.45rem 0.75rem',
                          borderRadius: '6px',
                        }}
                      >
                        <div className="flex-row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                          <span>🏸 {planAct.name}</span>
                          <span className="type-tag type-sport" style={{ fontSize: '0.7rem' }}>Planned Sport</span>
                        </div>
                        <div className="flex-row" style={{ gap: '0.35rem' }}>
                          <button
                            className="btn-primary"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                            onClick={() => {
                              handleLogSportAttendance(day, planAct.name)
                              handleRemovePlannedExtraActivity(day.isoDate, planAct.id)
                            }}
                          >
                            Attended
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                            onClick={() => handleRemovePlannedExtraActivity(day.isoDate, planAct.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer action to add an unplanned or extra activity to this day */}
              <div style={{ marginTop: '0.65rem' }}>
                <button
                  className="btn-secondary"
                  style={{
                    padding: '0.35rem 0.7rem',
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    borderStyle: 'dashed',
                  }}
                  onClick={() => openAddActivityModal(day)}
                >
                  + Add Unplanned Sport / Activity
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal: Edit Day Schedule */}
      {editingDay && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingDay(null)
          }}
        >
          <div className="modal-content animate-slide-up" style={{ maxWidth: '480px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                Edit Plan: {editingDay.dayName}
              </h2>
              <button className="btn-icon btn-secondary" onClick={() => setEditingDay(null)}>
                ✕
              </button>
            </div>

            <div className="flex-col" style={{ gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Activity / Session Name
                </label>
                <input
                  type="text"
                  value={editSessionName}
                  onChange={(e) => setEditSessionName(e.target.value)}
                  placeholder="e.g. Lower Body A, Badminton, Rest"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Session Type
                </label>
                <div className="flex-row" style={{ gap: '0.5rem' }}>
                  {(['lift', 'sport', 'rest'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={editType === t ? 'btn-primary' : 'btn-secondary'}
                      style={{ flex: 1, padding: '0.5rem', textTransform: 'capitalize' }}
                      onClick={() => setEditType(t)}
                    >
                      {t === 'lift' ? '🏋️ Lift' : t === 'sport' ? '🏸 Sport' : '☕ Rest'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Emphasis / Timing
                </label>
                <input
                  type="text"
                  value={editEmphasis}
                  onChange={(e) => setEditEmphasis(e.target.value)}
                  placeholder="e.g. 7:00 PM – 9:00 PM or Squat focus"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Notes / Routine details
                </label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional details or reminders"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div className="flex-between" style={{ marginTop: '0.75rem', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleResetDayToDefault}
                  style={{ color: 'var(--text-muted)' }}
                >
                  Reset to Default
                </button>
                <div className="flex-row" style={{ gap: '0.5rem' }}>
                  <button type="button" className="btn-secondary" onClick={() => setEditingDay(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-primary" onClick={handleSaveDayEdit}>
                    Save Plan
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Unplanned / Extra Sport Activity */}
      {addingActivityDay && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddingActivityDay(null)
          }}
        >
          <div className="modal-content animate-slide-up" style={{ maxWidth: '480px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                Add Activity: {addingActivityDay.dayName} ({addingActivityDay.dateStr})
              </h2>
              <button className="btn-icon btn-secondary" onClick={() => setAddingActivityDay(null)}>
                ✕
              </button>
            </div>

            <div className="flex-col" style={{ gap: '1rem' }}>
              {/* Fast Presets */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Quick Presets
                </label>
                <div className="flex-row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                  {SPORT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="btn-secondary"
                      style={{
                        padding: '0.3rem 0.6rem',
                        fontSize: '0.78rem',
                        background: activityName === preset ? 'rgba(59, 130, 246, 0.25)' : undefined,
                        borderColor: activityName === preset ? 'var(--primary-color)' : undefined,
                      }}
                      onClick={() => setActivityName(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Activity Name *
                </label>
                <input
                  type="text"
                  value={activityName}
                  onChange={(e) => setActivityName(e.target.value)}
                  placeholder="e.g. Badminton, 5km Run, Swimming"
                  autoFocus
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Status
                </label>
                <div className="flex-row" style={{ gap: '0.5rem' }}>
                  <button
                    type="button"
                    className={activityStatus === 'completed' ? 'btn-primary' : 'btn-secondary'}
                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
                    onClick={() => setActivityStatus('completed')}
                  >
                    ✓ Attended
                  </button>
                  <button
                    type="button"
                    className={activityStatus === 'skipped' ? 'btn-primary' : 'btn-secondary'}
                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
                    onClick={() => setActivityStatus('skipped')}
                  >
                    ✕ Skipped
                  </button>
                  <button
                    type="button"
                    className={activityStatus === 'planned' ? 'btn-primary' : 'btn-secondary'}
                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
                    onClick={() => setActivityStatus('planned')}
                  >
                    📋 Planned
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Duration in minutes (optional)
                </label>
                <input
                  type="number"
                  value={activityDuration}
                  onChange={(e) => setActivityDuration(e.target.value)}
                  placeholder="e.g. 60"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={activityNotes}
                  onChange={(e) => setActivityNotes(e.target.value)}
                  placeholder="e.g. High intensity drills, felt great"
                />
              </div>

              <div className="flex-between" style={{ marginTop: '0.75rem', gap: '0.75rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setAddingActivityDay(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!activityName.trim() || isSubmitting}
                  onClick={handleSaveNewActivity}
                >
                  {isSubmitting ? 'Saving…' : 'Save Activity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}