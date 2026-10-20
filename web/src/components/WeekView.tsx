import { useState, useEffect } from 'react'
import { api } from '../api'
import type { DayScheduleConfig, PlannedActivity, Routine, SessionPayload, WeekDayPlan, WeeklyPlanRead } from '../types'

interface WeekViewProps {
  routines: Routine[]
  sessions: SessionPayload[]
  onStartRoutine: (routine: Routine) => void
  onSaveSession: (session: SessionPayload) => Promise<void>
  onDeleteSession: (sessionId: string) => Promise<void>
}

const STORAGE_KEY_OVERRIDES = 'kratos_weekly_plan_overrides'
const STORAGE_KEY_EXTRA_ACTIVITIES = 'kratos_extra_activities'

export const EMPTY_DAY_CONFIG: DayScheduleConfig = {
  sessionName: 'No session planned',
  type: 'none',
  emphasis: 'Rest / unscheduled day',
  notes: undefined,
}

export function getISOWeekString(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

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

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toLocalISOString(isoDate: string, timeStr: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const [h, min, s = 0] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, h, min, s).toISOString()
}

function getSessionLocalDate(isoString: string): string {
  return formatLocalDate(new Date(isoString))
}

export function getCurrentWeekPlan(backendDays?: DayScheduleConfig[]): WeekDayPlan[] {
  const now = new Date()
  const dayIndex = (now.getDay() + 6) % 7 // Monday = 0
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayIndex)
  monday.setHours(0, 0, 0, 0)

  const overrides = loadPlanOverrides()
  const extras = loadExtraActivities()

  return DAY_NAMES.map((_, idx) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + idx)
    const isToday = d.toDateString() === now.toDateString()
    const isoDate = formatLocalDate(d)
    const dateStr = `${d.getDate()} ${MONTHS[d.getMonth()]}`

    const backendConfig = backendDays && backendDays[idx] ? backendDays[idx] : EMPTY_DAY_CONFIG
    const config = overrides[idx] || backendConfig
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
  const [backendPlan, setBackendPlan] = useState<WeeklyPlanRead | null>(null)
  const [weekPlan, setWeekPlan] = useState<WeekDayPlan[]>(() => getCurrentWeekPlan())
  const [editingDay, setEditingDay] = useState<WeekDayPlan | null>(null)
  const [editSessionName, setEditSessionName] = useState('')
  const [editType, setEditType] = useState<'lift' | 'sport' | 'rest' | 'none'>('lift')
  const [editEmphasis, setEditEmphasis] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const currentIsoWeek = getISOWeekString(new Date())

  // Modal for adding unplanned / additional sport activity
  const [addingActivityDay, setAddingActivityDay] = useState<WeekDayPlan | null>(null)
  const [activityName, setActivityName] = useState('')
  const [activityType, setActivityType] = useState<'sport' | 'lift'>('sport')
  const [activityStatus, setActivityStatus] = useState<'completed' | 'skipped' | 'planned'>('completed')
  const [activityDuration, setActivityDuration] = useState('')
  const [activityNotes, setActivityNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const refreshWeekPlan = (backendDays?: DayScheduleConfig[]) => {
    setWeekPlan(getCurrentWeekPlan(backendDays || backendPlan?.days))
  }

  useEffect(() => {
    let active = true
    api.getWeeklyPlan(currentIsoWeek).then((plan) => {
      if (active && plan) {
        setBackendPlan(plan)
        setWeekPlan(getCurrentWeekPlan(plan.days))
      }
    })
    return () => {
      active = false
    }
  }, [currentIsoWeek])

  useEffect(() => {
    refreshWeekPlan()
  }, [sessions])

  const mondayDate = weekPlan[0]?.dateStr ?? ''
  const sundayDate = weekPlan[6]?.dateStr ?? ''

  // Open edit day modal
  const openEditDayModal = (day: WeekDayPlan) => {
    setEditingDay(day)
    setEditSessionName(day.sessionName === 'No session planned' ? '' : day.sessionName)
    setEditType(day.type)
    setEditEmphasis(day.emphasis === 'Rest / unscheduled day' ? '' : day.emphasis)
    setEditNotes(day.notes || '')
  }

  const handleSaveDayEdit = async () => {
    if (!editingDay) return
    const overrides = loadPlanOverrides()
    const newConfig: DayScheduleConfig = {
      dayIndex: editingDay.dayIndex,
      sessionName: editSessionName.trim() || (editType === 'none' ? 'No session planned' : editingDay.sessionName),
      type: editType,
      emphasis: editEmphasis.trim() || (editType === 'none' ? 'Rest / unscheduled day' : ''),
      notes: editNotes.trim() || undefined,
    }
    overrides[editingDay.dayIndex] = newConfig
    savePlanOverrides(overrides)
    setEditingDay(null)

    const updatedDays = weekPlan.map((d) =>
      d.dayIndex === editingDay.dayIndex
        ? newConfig
        : {
            dayIndex: d.dayIndex,
            sessionName: d.sessionName,
            type: d.type,
            emphasis: d.emphasis,
            notes: d.notes,
          }
    )

    try {
      const saved = await api.putWeeklyPlan({
        iso_week: currentIsoWeek,
        days: updatedDays,
      })
      if (saved) {
        setBackendPlan(saved)
      }
    } catch {
      // fallback to local
    }
    refreshWeekPlan(updatedDays)
  }

  const handleResetDayToDefault = async () => {
    if (!editingDay) return
    const overrides = loadPlanOverrides()
    delete overrides[editingDay.dayIndex]
    savePlanOverrides(overrides)
    setEditingDay(null)

    const fallbackConfig = backendPlan?.days?.[editingDay.dayIndex] || EMPTY_DAY_CONFIG
    const updatedDays = weekPlan.map((d) =>
      d.dayIndex === editingDay.dayIndex
        ? {
            dayIndex: d.dayIndex,
            sessionName: fallbackConfig.sessionName,
            type: fallbackConfig.type,
            emphasis: fallbackConfig.emphasis,
            notes: fallbackConfig.notes,
          }
        : {
            dayIndex: d.dayIndex,
            sessionName: d.sessionName,
            type: d.type,
            emphasis: d.emphasis,
            notes: d.notes,
          }
    )

    try {
      const saved = await api.putWeeklyPlan({
        iso_week: currentIsoWeek,
        days: updatedDays,
      })
      if (saved) {
        setBackendPlan(saved)
      }
    } catch {
      // fallback
    }
    refreshWeekPlan(updatedDays)
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
          started_at: toLocalISOString(addingActivityDay.isoDate, '12:00:00'),
          ended_at: activityStatus === 'completed' ? toLocalISOString(addingActivityDay.isoDate, '13:00:00') : null,
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
    return sessions.filter((s) => {
      if (!s.started_at) return false
      return getSessionLocalDate(s.started_at) === isoDate
    })
  }

  // Log sport attendance
  const handleLogSportAttendance = async (day: WeekDayPlan, actName: string) => {
    setIsSubmitting(true)
    try {
      const newSession: SessionPayload = {
        id: crypto.randomUUID(),
        routine_id: null,
        started_at: toLocalISOString(day.isoDate, '19:00:00'),
        ended_at: toLocalISOString(day.isoDate, '21:00:00'),
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
        started_at: toLocalISOString(day.isoDate, '19:00:00'),
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
        started_at: toLocalISOString(day.isoDate, '12:00:00'),
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

          // Check completed lift session (only if day type is 'lift' and not an unplanned activity)
          const completedLiftSession = day.type === 'lift'
            ? daySessions.find(
                (s) =>
                  !s.extra?.is_unplanned &&
                  s.extra?.status !== 'skipped' &&
                  ((matchingRoutine && s.routine_id === matchingRoutine.id) ||
                    (s.extra?.routine_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                    s.items.length > 0 ||
                    s.extra?.session_type === 'lift')
              )
            : undefined

          // Check skipped lift session
          const skippedLiftSession = day.type === 'lift'
            ? daySessions.find(
                (s) =>
                  !s.extra?.is_unplanned &&
                  s.extra?.status === 'skipped' &&
                  ((matchingRoutine && s.routine_id === matchingRoutine.id) ||
                    (s.extra?.routine_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                    s.extra?.session_type === 'lift')
              )
            : undefined

          // Check sport attended session (only if day type is 'sport' and not an unplanned activity)
          const attendedSportSession = day.type === 'sport'
            ? daySessions.find(
                (s) =>
                  !s.extra?.is_unplanned &&
                  s.extra?.status === 'completed' &&
                  ((s.extra?.activity_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                    s.extra?.session_type === 'sport')
              )
            : undefined

          // Check sport skipped session
          const skippedSportSession = day.type === 'sport'
            ? daySessions.find(
                (s) =>
                  !s.extra?.is_unplanned &&
                  s.extra?.status === 'skipped' &&
                  ((s.extra?.activity_name as string)?.toLowerCase() === day.sessionName.toLowerCase() ||
                    s.extra?.session_type === 'sport')
              )
            : undefined

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
                  {day.type === 'none' && (
                    <span className="badge-rest" style={{ opacity: 0.65 }}>Unscheduled</span>
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
                    {day.type === 'lift' ? '🏋️ Lift' : day.type === 'sport' ? '🏸 Sport' : day.type === 'rest' ? '☕ Rest & Fast' : '⚪ Unscheduled'}
                  </span>
                </div>
              </div>

              {/* Primary Activity Info & Actions */}
              <div className="flex-between" style={{ alignItems: 'center', marginTop: '0.4rem', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: day.type === 'none' ? 'var(--text-secondary)' : '#fff', marginBottom: '0.2rem' }}>
                    {day.sessionName}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: day.type === 'none' ? 'var(--text-muted)' : 'var(--text-primary)', opacity: day.type === 'none' ? 0.75 : 0.9, margin: 0 }}>
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
                  {/* Unscheduled Day Action */}
                  {day.type === 'none' && (
                    <button
                      className="btn-secondary"
                      style={{
                        padding: '0.5rem 0.85rem',
                        fontSize: '0.82rem',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => openEditDayModal(day)}
                    >
                      + Plan Day
                    </button>
                  )}
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
                      const duration = extra.extra?.duration_minutes as number | undefined

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
                            {Boolean(duration) && <span className="badge-duration">⏱ {duration}m</span>}
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
                  placeholder="e.g. Upper Body A, Badminton, Rest"
                />
                {editType === 'lift' && routines.length > 0 && (
                  <div className="flex-row" style={{ gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                    {routines.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="btn-secondary"
                        style={{
                          fontSize: '0.78rem',
                          padding: '0.25rem 0.55rem',
                          borderRadius: '4px',
                          borderColor: editSessionName.toLowerCase().trim() === r.name.toLowerCase().trim() ? 'var(--primary)' : undefined,
                          color: editSessionName.toLowerCase().trim() === r.name.toLowerCase().trim() ? 'var(--primary)' : undefined,
                        }}
                        onClick={() => {
                          setEditSessionName(r.name)
                          if (!editEmphasis) {
                            setEditEmphasis(`${r.name.includes('Upper') ? 'Upper body' : 'Lower body'} • 4 exercises × 2 sets`)
                          }
                        }}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                  Session Type
                </label>
                <div className="flex-row" style={{ gap: '0.5rem' }}>
                  {(['lift', 'sport', 'rest', 'none'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={editType === t ? 'btn-primary' : 'btn-secondary'}
                      style={{ flex: 1, padding: '0.5rem', textTransform: 'capitalize' }}
                      onClick={() => {
                        setEditType(t)
                        if (t === 'none') {
                          setEditSessionName('No session planned')
                          setEditEmphasis('Rest / unscheduled day')
                        }
                      }}
                    >
                      {t === 'lift' ? '🏋️ Lift' : t === 'sport' ? '🏸 Sport' : t === 'rest' ? '☕ Rest' : '⚪ None'}
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