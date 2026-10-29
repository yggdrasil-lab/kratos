import { useState } from 'react'
import type { Exercise, SessionPayload, SetEntry } from '../types'

interface HistoryViewProps {
  sessions: SessionPayload[]
  exercises: Exercise[]
  onUpdateSession: (updated: SessionPayload) => Promise<void>
  onDeleteSession: (sessionId: string) => Promise<void>
  onRefresh: () => Promise<void>
  loading?: boolean
}

export function HistoryView({
  sessions,
  exercises,
  onUpdateSession,
  onDeleteSession,
  onRefresh,
  loading = false,
}: HistoryViewProps) {
  const [editingSession, setEditingSession] = useState<SessionPayload | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const getExerciseName = (exerciseId: string) => {
    return exercises.find((e) => e.id === exerciseId)?.name || 'Exercise'
  }

  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString('en-NZ', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return isoString
    }
  }

  const calculateDuration = (startedAt: string, endedAt: string | null) => {
    if (!endedAt) return null
    try {
      const start = new Date(startedAt).getTime()
      const end = new Date(endedAt).getTime()
      const diffMins = Math.round((end - start) / (1000 * 60))
      if (diffMins < 1) return '< 1 min'
      return `${diffMins} min`
    } catch {
      return null
    }
  }

  const getActivityLabel = (sess: SessionPayload): string => {
    const extra = sess.extra || {}
    if (typeof extra.activity_name === 'string' && extra.activity_name.trim()) {
      return extra.activity_name.trim()
    }
    if (typeof extra.routine_name === 'string' && extra.routine_name.trim()) {
      return extra.routine_name.trim()
    }
    if (extra.session_type === 'sport') {
      return 'Sports Activity'
    }
    return 'Free Workout'
  }

  const getActivityIcon = (sess: SessionPayload): string => {
    const extra = sess.extra || {}
    const sessionType = extra.session_type as string | undefined
    const name = (
      (typeof extra.activity_name === 'string' ? extra.activity_name : '') ||
      (typeof extra.routine_name === 'string' ? extra.routine_name : '')
    ).toLowerCase()

    if (
      sessionType === 'sport' ||
      name.includes('badminton') ||
      name.includes('sport') ||
      name.includes('run') ||
      name.includes('swim') ||
      name.includes('bike') ||
      name.includes('cycl')
    ) {
      if (name.includes('badminton')) return '🏸'
      if (name.includes('run') || name.includes('jog')) return '🏃'
      if (name.includes('swim')) return '🏊'
      if (name.includes('cycl') || name.includes('bike')) return '🚴'
      return '🏅'
    }

    if (sess.routine_id || extra.routine_name || sessionType === 'lift') {
      return '🏋️'
    }

    return '⚡'
  }

  type WorkoutStatus = 'completed' | 'attended' | 'skipped' | 'in_progress'

  const getSessionStatus = (sess: SessionPayload): WorkoutStatus => {
    const extraStatus = sess.extra?.status as string | undefined
    if (extraStatus === 'skipped') return 'skipped'
    if (extraStatus === 'completed') {
      return sess.extra?.session_type === 'sport' ? 'attended' : 'completed'
    }
    if (sess.notes?.toLowerCase().startsWith('skipped')) {
      return 'skipped'
    }
    if (!sess.ended_at) {
      return 'in_progress'
    }
    const totalDoneSets = sess.items.reduce(
      (acc, it) => acc + it.sets.filter((s) => s.status === 'done').length,
      0
    )
    if (sess.items.length > 0 && totalDoneSets === 0) {
      return 'skipped'
    }
    return sess.extra?.session_type === 'sport' ? 'attended' : 'completed'
  }

  // --- Edit handlers ---
  const handleStartEdit = (session: SessionPayload) => {
    // Deep clone to allow editing safely
    setEditingSession(JSON.parse(JSON.stringify(session)))
    setStatusMessage(null)
  }

  const handleCancelEdit = () => {
    setEditingSession(null)
    setStatusMessage(null)
  }

  const handleSaveEdit = async () => {
    if (!editingSession) return
    setIsSaving(true)
    setStatusMessage(null)
    try {
      await onUpdateSession(editingSession)
      setEditingSession(null)
      setStatusMessage('Workout corrections saved successfully.')
      setTimeout(() => setStatusMessage(null), 3500)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to update session')
    } finally {
      setIsSaving(false)
    }
  }

  const handleUpdateSet = (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    value: number | null
  ) => {
    if (!editingSession) return
    const nextItems = [...editingSession.items]
    const nextSets = [...nextItems[itemIndex].sets]
    const prevSet = nextSets[setIndex]
    const updatedSet: SetEntry = {
      ...prevSet,
      [field]: value,
      status: (field === 'weight_kg' ? value : prevSet.weight_kg) === null &&
              (field === 'reps' ? value : prevSet.reps) === null
                ? 'skipped'
                : 'done',
    }
    nextSets[setIndex] = updatedSet
    nextItems[itemIndex] = { ...nextItems[itemIndex], sets: nextSets }
    setEditingSession({ ...editingSession, items: nextItems })
  }

  const handleRemoveSet = (itemIndex: number, setIndex: number) => {
    if (!editingSession) return
    const nextItems = [...editingSession.items]
    const nextSets = nextItems[itemIndex].sets
      .filter((_, idx) => idx !== setIndex)
      .map((s, idx) => ({ ...s, set_number: idx + 1 }))
    nextItems[itemIndex] = { ...nextItems[itemIndex], sets: nextSets }
    setEditingSession({ ...editingSession, items: nextItems })
  }

  const handleAddSet = (itemIndex: number) => {
    if (!editingSession) return
    const nextItems = [...editingSession.items]
    const currentSets = nextItems[itemIndex].sets
    const lastSet = currentSets[currentSets.length - 1]
    const newSet: SetEntry = {
      id: crypto.randomUUID(),
      set_number: currentSets.length + 1,
      status: 'done',
      weight_kg: lastSet?.weight_kg ?? null,
      reps: lastSet?.reps ?? null,
      duration_s: null,
      distance_m: null,
      rpe: null,
      notes: null,
      extra: {},
    }
    nextItems[itemIndex] = { ...nextItems[itemIndex], sets: [...currentSets, newSet] }
    setEditingSession({ ...editingSession, items: nextItems })
  }

  const handleRemoveExercise = (itemIndex: number) => {
    if (!editingSession) return
    const nextItems = editingSession.items.filter((_, idx) => idx !== itemIndex)
    setEditingSession({ ...editingSession, items: nextItems })
  }

  // --- Delete handlers ---
  const confirmDelete = async () => {
    if (!deletingId) return
    setIsSaving(true)
    try {
      await onDeleteSession(deletingId)
      setDeletingId(null)
      setStatusMessage('Workout session removed.')
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to delete session')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="animate-slide-up">
      <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Workout History</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Review past sessions and manage or correct logged metrics
          </p>
        </div>
        <button
          className="btn-secondary"
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {statusMessage && (
        <div
          className="glass-panel"
          style={{
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            borderColor: 'var(--primary-color)',
            background: 'rgba(59, 130, 246, 0.1)',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{statusMessage}</p>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.05)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <h3>No workouts logged yet</h3>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            Completed workouts will appear here with set details and editing options.
          </p>
        </div>
      ) : (
        <div className="flex-col" style={{ gap: '1rem' }}>
          {sessions.map((sess) => {
            const label = getActivityLabel(sess)
            const icon = getActivityIcon(sess)
            const status = getSessionStatus(sess)
            const duration =
              (sess.extra?.duration_minutes ? `${sess.extra.duration_minutes} min` : null) ||
              calculateDuration(sess.started_at, sess.ended_at)
            const totalSets = sess.items.reduce(
              (acc, it) => acc + it.sets.filter((s) => s.status === 'done').length,
              0
            )
            const isSport = sess.extra?.session_type === 'sport'

            return (
              <div key={sess.id} className="glass-panel history-card" style={{ margin: 0, padding: '1.25rem' }}>
                <div className="flex-between" style={{ alignItems: 'flex-start', marginBottom: '0.75rem', gap: '0.5rem' }}>
                  <div className="flex-row" style={{ gap: '0.75rem', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.35rem',
                        background:
                          status === 'skipped'
                            ? 'rgba(239, 68, 68, 0.12)'
                            : isSport
                            ? 'rgba(16, 185, 129, 0.12)'
                            : 'rgba(59, 130, 246, 0.12)',
                        border:
                          status === 'skipped'
                            ? '1px solid rgba(239, 68, 68, 0.25)'
                            : isSport
                            ? '1px solid rgba(16, 185, 129, 0.25)'
                            : '1px solid rgba(59, 130, 246, 0.25)',
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex-row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: '1.15rem', color: '#fff', margin: 0 }}>{label}</h3>
                        {status === 'completed' && <span className="badge-completed">✓ Completed</span>}
                        {status === 'attended' && <span className="badge-completed">✓ Attended</span>}
                        {status === 'skipped' && <span className="badge-missed">✕ Skipped</span>}
                        {status === 'in_progress' && (
                          <span className="badge-duration" style={{ color: 'var(--primary-color)' }}>
                            In Progress
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                        {formatDateTime(sess.started_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex-row" style={{ gap: '0.35rem', alignItems: 'center', flexWrap: 'nowrap', flexShrink: 0 }}>
                    {duration && <span className="badge-duration">{duration}</span>}
                    <button
                      className="btn-icon btn-secondary"
                      onClick={() => handleStartEdit(sess)}
                      title="Edit Workout Metrics"
                      style={{ padding: '0.35rem' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button
                      className="btn-icon btn-danger"
                      onClick={() => setDeletingId(sess.id)}
                      title="Delete Session"
                      style={{ padding: '0.35rem' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>

                {sess.notes && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                    &ldquo;{sess.notes}&rdquo;
                  </p>
                )}

                {sess.items.length > 0 ? (
                  <div className="flex-col" style={{ gap: '0.6rem' }}>
                    {sess.items.map((item) => {
                      const exName = getExerciseName(item.exercise_id)
                      const doneSets = item.sets.filter((s) => s.status === 'done')
                      return (
                        <div key={item.id} className="history-exercise-row">
                          <span className="history-exercise-name">{exName}</span>
                          <div className="history-sets-wrap">
                            {doneSets.length > 0 ? (
                              doneSets.map((s) => (
                                <span key={s.id} className="set-chip">
                                  {s.weight_kg !== null ? `${s.weight_kg}kg` : 'BW'} × {s.reps ?? 0}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No completed sets</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No exercises recorded.</p>
                )}

                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {totalSets} total completed sets
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Edit Workout Modal */}
      {editingSession && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleCancelEdit() }}>
          <div className="modal-content animate-slide-up" style={{ maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.3rem' }}>
                  Edit Workout: {(editingSession.extra?.routine_name as string) || 'Session'}
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {formatDateTime(editingSession.started_at)}
                </p>
              </div>
              <button className="btn-icon btn-secondary" onClick={handleCancelEdit}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                Session Notes
              </label>
              <input
                type="text"
                placeholder="Add any notes or context..."
                value={editingSession.notes || ''}
                onChange={(e) => setEditingSession({ ...editingSession, notes: e.target.value || null })}
              />
            </div>

            <div className="flex-col" style={{ gap: '1.25rem' }}>
              {editingSession.items.map((item, itemIdx) => {
                const exName = getExerciseName(item.exercise_id)
                return (
                  <div key={item.id} className="workout-item" style={{ padding: '0.9rem' }}>
                    <div className="flex-between" style={{ marginBottom: '0.6rem' }}>
                      <strong style={{ fontSize: '1rem', color: '#fff' }}>{exName}</strong>
                      <button
                        className="btn-icon btn-danger"
                        onClick={() => handleRemoveExercise(itemIdx)}
                        title="Remove Exercise"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>

                    <div className="flex-col" style={{ gap: '0.5rem' }}>
                      <div className="set-row" style={{ color: 'var(--text-muted)', fontSize: '0.75rem', paddingBottom: '0.1rem' }}>
                        <div style={{ textAlign: 'center' }}>SET</div>
                        <div>KG</div>
                        <div>REPS</div>
                        <div></div>
                      </div>

                      {item.sets.map((set, setIdx) => (
                        <div key={set.id} className="set-row">
                          <div className="set-number">{set.set_number}</div>
                          <input
                            type="number"
                            step="0.5"
                            placeholder="Weight"
                            value={set.weight_kg !== null ? set.weight_kg : ''}
                            onChange={(e) =>
                              handleUpdateSet(
                                itemIdx,
                                setIdx,
                                'weight_kg',
                                e.target.value ? parseFloat(e.target.value) : null
                              )
                            }
                          />
                          <input
                            type="number"
                            placeholder="Reps"
                            value={set.reps !== null ? set.reps : ''}
                            onChange={(e) =>
                              handleUpdateSet(
                                itemIdx,
                                setIdx,
                                'reps',
                                e.target.value ? parseInt(e.target.value) : null
                              )
                            }
                          />
                          <button
                            className="btn-icon btn-secondary"
                            onClick={() => handleRemoveSet(itemIdx, setIdx)}
                            title="Remove set"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      className="btn-secondary"
                      style={{ width: '100%', marginTop: '0.6rem', padding: '0.4rem', fontSize: '0.8rem' }}
                      onClick={() => handleAddSet(itemIdx)}
                    >
                      + Add Set
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex-row" style={{ gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={handleCancelEdit} disabled={isSaving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSaveEdit} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Corrections'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDeletingId(null) }}>
          <div className="modal-content animate-slide-up" style={{ maxWidth: '400px' }}>
            <h3 style={{ margin: 0, color: 'var(--danger-color)', marginBottom: '0.75rem' }}>
              Delete Workout Session?
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              This will remove the session from your history and update your training stats.
            </p>
            <div className="flex-row" style={{ gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setDeletingId(null)} disabled={isSaving}>
                Cancel
              </button>
              <button
                className="btn-danger"
                style={{ padding: '0.6rem 1.2rem', borderRadius: '8px', cursor: 'pointer' }}
                onClick={confirmDelete}
                disabled={isSaving}
              >
                {isSaving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
