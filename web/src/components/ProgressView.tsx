import { useState } from 'react'
import type { DailyBiometrics, Exercise, FastingCheckIn, SessionPayload } from '../types'
import { formatFriendlyDate } from '../utils/circadian'

interface ProgressViewProps {
  sessions: SessionPayload[]
  exercises: Exercise[]
  fastingLogs: FastingCheckIn[]
  biometrics: DailyBiometrics | null
  onDeleteSession: (id: string) => Promise<void>
}

export function ProgressView({
  sessions,
  exercises,
  fastingLogs,
  biometrics,
  onDeleteSession,
}: ProgressViewProps) {
  const [showArchive, setShowArchive] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')

  // Goal math: 90kg start -> 80kg target
  const startWeight = 90.0
  const targetWeight = 80.0
  const currentWeight = biometrics?.latest_weight_kg ? Number(biometrics.latest_weight_kg) : 86.65
  const totalToLose = startWeight - targetWeight // 10kg
  const lostSoFar = Math.max(0, startWeight - currentWeight)
  const progressPercent = Math.min(100, Math.max(0, Math.round((lostSoFar / totalToLose) * 100)))

  // Milestone check
  const nextMilestone = currentWeight > 85.0 ? 85.0 : currentWeight > 82.5 ? 82.5 : 80.0

  // Filter sessions: Last 7 days vs older archive
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const recentSessions = sessions.filter((s) => new Date(s.started_at) >= sevenDaysAgo)
  const olderSessions = sessions.filter((s) => new Date(s.started_at) < sevenDaysAgo)

  const filteredArchive = search.trim()
    ? olderSessions.filter((s) => {
        const routineName = (s.extra?.routine_name as string) || ''
        const notes = s.notes || ''
        return routineName.toLowerCase().includes(search.toLowerCase()) || notes.toLowerCase().includes(search.toLowerCase())
      })
    : olderSessions

  const getExerciseName = (id: string) => {
    const ex = exercises.find((e) => e.id === id)
    return ex ? ex.name : 'Exercise'
  }

  const computeSessionStats = (s: SessionPayload) => {
    let volume = 0
    let sets = 0
    s.items.forEach((it) => {
      it.sets.forEach((set) => {
        if (set.status === 'done') {
          sets += 1
          volume += (set.weight_kg ?? 0) * (set.reps ?? 0)
        }
      })
    })
    const durationMins = s.ended_at
      ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000))
      : null
    return { volume: Math.round(volume), sets, durationMins }
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '5rem' }}>
      {/* Title */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.1rem 0' }}>
          Progress and Momentum
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Milestone tracking, last 7 days activity, and correlations.
        </p>
      </div>

      {/* 1. Goal Milestone Tracker (80kg Goal) */}
      <div className="glass-panel animate-slide-up" style={{
        marginBottom: '1.5rem',
        padding: '1.25rem',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(15, 23, 42, 0.6))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase' }}>
              Goal: Reach 80 kg
            </span>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.1rem' }}>
              {currentWeight.toFixed(1)} kg <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>(-{lostSoFar.toFixed(1)} kg)</span>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Next Milestone</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#c084fc' }}>{nextMilestone.toFixed(1)} kg</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{
          height: '10px',
          width: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '5px',
          overflow: 'hidden',
          margin: '0.75rem 0 0.5rem 0',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, #3b82f6, #10b981)',
            borderRadius: '5px',
            transition: 'width 0.4s ease',
          }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>Start: 90.0 kg</span>
          <span>{progressPercent}% towards 80 kg</span>
          <span>Target: 80.0 kg</span>
        </div>
      </div>

      {/* 2. Last 7 Days Completed Activity Stream */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🏋️</span> Last 7 Days Workouts ({recentSessions.length})
        </h3>

        {recentSessions.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No workouts logged in the last 7 days. Tap &quot;Today&quot; to start your next session!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {recentSessions.map((s) => {
              const stats = computeSessionStats(s)
              const effort = (s.extra?.effort_rating as string) || ''
              const tags = (s.extra?.effort_tags as string[]) || []
              const routineName = (s.extra?.routine_name as string) || 'Gym Session'
              const dateStr = s.started_at.split('T')[0]

              let effortBadge = null
              if (effort === 'too_easy') {
                effortBadge = <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 600 }}>🟢 Too Easy</span>
              } else if (effort === 'optimal') {
                effortBadge = <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontWeight: 600 }}>🟡 Optimal</span>
              } else if (effort === 'hard') {
                effortBadge = <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', backgroundColor: 'rgba(249, 115, 22, 0.15)', color: '#f97316', fontWeight: 600 }}>🟠 Hard</span>
              } else if (effort === 'too_hard') {
                effortBadge = <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 600 }}>🔴 Too Hard</span>
              }

              return (
                <div key={s.id} className="glass-panel" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {formatFriendlyDate(dateStr)}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                        {routineName}
                      </div>
                    </div>
                    {effortBadge}
                  </div>

                  {/* Summary row */}
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', gap: '0.75rem' }}>
                    {stats.durationMins && <span>⏱️ {stats.durationMins} min</span>}
                    <span>📦 {stats.volume.toLocaleString()} kg volume</span>
                    <span>✓ {stats.sets} sets</span>
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {tags.map((t, idx) => (
                        <span key={idx} style={{ fontSize: '0.7rem', color: '#c084fc', backgroundColor: 'rgba(139, 92, 246, 0.15)', padding: '0.15rem 0.4rem', borderRadius: '0.3rem' }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Performed exercise pills */}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {s.items.map((it) => (
                      <span key={it.id} style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', padding: '0.2rem 0.4rem', borderRadius: '0.25rem' }}>
                        {getExerciseName(it.exercise_id)} ({it.sets.filter((x) => x.status === 'done').length} sets)
                      </span>
                    ))}
                  </div>

                  {/* Reflection Notes */}
                  {s.notes && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                      &ldquo;{s.notes}&rdquo;
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 3. Fasting History Stream */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>⏱️</span> Fasting History ({fastingLogs.length})
        </h3>

        {fastingLogs.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No fasting logs recorded yet. Use the Fasting Card on &quot;Today&quot; to log your check-ins!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {fastingLogs.slice(0, 7).map((f) => (
              <div key={f.id} className="glass-panel" style={{
                padding: '0.75rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    {formatFriendlyDate(f.date)} ({f.target_window})
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Energy: {f.energy} • Headache: {f.headache}
                    {f.notes ? ` • "${f.notes}"` : ''}
                  </div>
                </div>

                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.2rem 0.5rem',
                  borderRadius: '0.3rem',
                  backgroundColor: f.adherence === 'completed'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : f.adherence === 'early'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  color: f.adherence === 'completed' ? '#10b981' : f.adherence === 'early' ? '#f59e0b' : '#ef4444',
                }}>
                  {f.adherence === 'completed' ? '✓ Completed' : f.adherence === 'early' ? '⚡ Broke Early' : '🔴 Off-Plan'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Older History Collapsible Archive */}
      <div className="glass-panel" style={{ padding: '1rem' }}>
        <div
          onClick={() => setShowArchive(!showArchive)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            Older Sessions Archive ({olderSessions.length})
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {showArchive ? '▲ Hide' : '▼ Expand'}
          </span>
        </div>

        {showArchive && (
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <input
              type="text"
              placeholder="Search older sessions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.4rem',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--surface-border)',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                marginBottom: '0.75rem',
              }}
            />

            {filteredArchive.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                No older sessions match your search.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {filteredArchive.map((s) => (
                  <div key={s.id} style={{
                    padding: '0.6rem 0.8rem',
                    borderRadius: '0.4rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                        {(s.extra?.routine_name as string) || 'Gym Session'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {s.started_at.split('T')[0]} • {s.items.length} exercises
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(s.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--danger-color)',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
