import type { Routine, SessionPayload, WeekDayPlan } from '../types'

interface WeekViewProps {
  routines: Routine[]
  sessions: SessionPayload[]
  onStartRoutine: (routine: Routine) => void
}

export function getCurrentWeekPlan(): WeekDayPlan[] {
  const now = new Date()
  const dayIndex = (now.getDay() + 6) % 7 // Monday = 0
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayIndex)
  monday.setHours(0, 0, 0, 0)

  const scheduleConfig = [
    {
      dayName: 'Monday',
      dayShort: 'Mon',
      sessionName: 'Lower Body A',
      type: 'lift' as const,
      emphasis: 'Squat emphasis • 4 exercises × 2 sets to failure',
      notes: 'Goblet Squat (depth > weight), DB Deadlift, Calf Raise, Plank',
    },
    {
      dayName: 'Tuesday',
      dayShort: 'Tue',
      sessionName: 'Badminton',
      type: 'sport' as const,
      emphasis: '7:00 PM – 9:00 PM • Fixed court session',
      notes: 'Fixed sport session. High intensity cardio & agility. No lifting.',
    },
    {
      dayName: 'Wednesday',
      dayShort: 'Wed',
      sessionName: 'Upper Body A',
      type: 'lift' as const,
      emphasis: 'Push emphasis • 4 exercises × 2 sets to failure',
      notes: 'Incline DB Bench, Overhead Press, Seated Machine Row, Cable Face Pull',
    },
    {
      dayName: 'Thursday',
      dayShort: 'Thu',
      sessionName: 'Badminton',
      type: 'sport' as const,
      emphasis: '7:00 PM – 9:00 PM • Fixed court session',
      notes: 'Fixed sport session. High intensity cardio & agility. No lifting.',
    },
    {
      dayName: 'Friday',
      dayShort: 'Fri',
      sessionName: 'Rest + Long Fast',
      type: 'rest' as const,
      emphasis: 'Full recovery & long fast window (18–24h)',
      notes: 'No training. Fasting protocol per Health vault guide.',
    },
    {
      dayName: 'Saturday',
      dayShort: 'Sat',
      sessionName: 'Lower Body B',
      type: 'lift' as const,
      emphasis: 'Hinge emphasis • 4 exercises × 2 sets to failure',
      notes: 'Primary DB Deadlift, Bodyweight Lunge, Lying Leg Curl, Leg Extension',
    },
    {
      dayName: 'Sunday',
      dayShort: 'Sun',
      sessionName: 'Upper Body B',
      type: 'lift' as const,
      emphasis: 'Pull emphasis • 4 exercises × 2 sets to failure',
      notes: 'Wide Lat Pulldown, DB Bench Press, Bent-Over One Arm Row, Triceps Pushdown',
    },
  ]

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return scheduleConfig.map((item, idx) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + idx)
    const isToday = d.toDateString() === now.toDateString()
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dateStr = `${d.getDate()} ${months[d.getMonth()]}`

    return {
      ...item,
      dateStr,
      isoDate,
      isToday,
    }
  })
}

export function WeekView({ routines, sessions, onStartRoutine }: WeekViewProps) {
  const weekPlan = getCurrentWeekPlan()
  const mondayDate = weekPlan[0]?.dateStr ?? ''
  const sundayDate = weekPlan[6]?.dateStr ?? ''

  // Find completed sessions for each day
  const isDayCompleted = (isoDate: string, sessionName: string) => {
    return sessions.some((s) => {
      const sDate = s.started_at ? s.started_at.slice(0, 10) : ''
      if (sDate !== isoDate) return false
      const routineName = (s.extra?.routine_name as string) || ''
      return routineName.toLowerCase() === sessionName.toLowerCase() || s.items.length > 0
    })
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
          const matchingRoutine = routines.find(
            (r) => r.name.toLowerCase().trim() === day.sessionName.toLowerCase().trim()
          )
          const completed = isDayCompleted(day.isoDate, day.sessionName)

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
              <div className="flex-between" style={{ alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div className="flex-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
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
                  {day.isToday && (
                    <span className="badge-today">
                      Today
                    </span>
                  )}
                  {completed && (
                    <span className="badge-completed">
                      ✓ Completed
                    </span>
                  )}
                </div>

                <span
                  className={`type-tag type-${day.type}`}
                >
                  {day.type === 'lift' ? '🏋️ Lift' : day.type === 'sport' ? '🏸 Sport' : '☕ Rest & Fast'}
                </span>
              </div>

              <div className="flex-between" style={{ alignItems: 'center', marginTop: '0.4rem', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#fff', marginBottom: '0.2rem' }}>
                    {day.sessionName}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', opacity: 0.9 }}>
                    {day.emphasis}
                  </p>
                  {day.notes && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {day.notes}
                    </p>
                  )}
                </div>

                {day.type === 'lift' && matchingRoutine && (
                  <button
                    className="btn-primary"
                    style={{
                      padding: '0.55rem 0.95rem',
                      fontSize: '0.85rem',
                      whiteSpace: 'nowrap',
                      alignSelf: 'center',
                    }}
                    onClick={() => onStartRoutine(matchingRoutine)}
                  >
                    {completed ? 'Re-run' : 'Start'} Workout
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
