import { useEffect, useState } from 'react'
import { api } from './api'
import { db, requestPersistence } from './db'
import { drainOutbox, pendingCount, queueSession, type SyncStatus } from './outbox'
import type { ActiveTab, Exercise, Routine, SessionItemPayload, SessionPayload } from './types'
import { WeekView } from './components/WeekView'
import { HistoryView } from './components/HistoryView'
import { BottomNav } from './components/BottomNav'

const DRAFT_KEY = 'current'

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('train')
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' })
  const [queued, setQueued] = useState<number>(0)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [sessions, setSessions] = useState<SessionPayload[]>([])
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false)
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [showExercisePicker, setShowExercisePicker] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')

  const sync = async () => {
    try {
      await drainOutbox(setStatus)
    } finally {
      setQueued(await pendingCount())
    }
  }

  const loadSessions = async () => {
    setLoadingHistory(true)
    try {
      const data = await api.sessions(50, 0)
      setSessions(data)
    } catch {
      // Offline fallback: check outbox sessions
      const queuedSessions = await db.outbox.toArray()
      if (queuedSessions.length > 0) {
        setSessions(queuedSessions.map((q) => q.payload))
      }
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    requestPersistence()
    sync()

    db.drafts.get(DRAFT_KEY).then((draft) => {
      if (draft) setSession(draft.session)
    })

    api.exercises().then(setExercises).catch(() => {
      setStatus({ kind: 'error', message: 'Failed to fetch catalogue' })
    })
    api.routines().then(setRoutines).catch(() => {
      // Non-fatal: user can still start an empty session.
    })
    loadSessions()
  }, [])

  const updateSession = (next: SessionPayload | null) => {
    setSession(next)
    if (next) {
      db.drafts.put({ id: DRAFT_KEY, session: next, savedAt: Date.now() })
    } else {
      db.drafts.delete(DRAFT_KEY)
    }
  }

  const startSession = (routine?: Routine) => {
    const id = crypto.randomUUID()
    const started_at = new Date().toISOString()
    const items: SessionItemPayload[] = (routine?.items ?? []).map((it, idx) => {
      const targetSets = it.target_sets ?? 1
      return {
        id: crypto.randomUUID(),
        exercise_id: it.exercise_id,
        position: idx + 1,
        notes: it.notes,
        extra: {
          target_reps: it.target_reps,
          target_weight_kg: it.target_weight_kg,
        },
        sets: Array.from({ length: targetSets }, (_, setIdx) => ({
          id: crypto.randomUUID(),
          set_number: setIdx + 1,
          // Planned sets start skipped; only recording a weight/rep flips to 'done'.
          status: 'skipped' as const,
          reps: null,
          weight_kg: null,
          duration_s: null,
          distance_m: null,
          rpe: null,
          notes: null,
          extra: {},
        })),
      }
    })
    updateSession({
      id,
      routine_id: routine?.id ?? null,
      started_at,
      ended_at: null,
      notes: null,
      extra: routine ? { routine_name: routine.name } : {},
      items,
    })
  }

  const finishSession = async () => {
    if (!session) return
    const ended_at = new Date().toISOString()
    const finalSession = { ...session, ended_at }
    await queueSession(finalSession)
    updateSession(null)
    await sync()
    await loadSessions()
    setActiveTab('history')
  }

  const handleUpdateSession = async (updated: SessionPayload) => {
    try {
      await api.putSession(updated)
    } catch {
      await queueSession(updated)
    }
    await loadSessions()
    await sync()
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId)
    } catch {
      await db.outbox.delete(sessionId)
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
  }

  const addExerciseToSession = (exercise: Exercise) => {
    if (!session) return
    const newItem: SessionItemPayload = {
      id: crypto.randomUUID(),
      exercise_id: exercise.id,
      position: session.items.length + 1,
      notes: null,
      extra: {},
      sets: [{
        id: crypto.randomUUID(),
        set_number: 1,
        status: 'skipped',
        reps: null,
        weight_kg: null,
        duration_s: null,
        distance_m: null,
        rpe: null,
        notes: null,
        extra: {},
      }],
    }
    updateSession({ ...session, items: [...session.items, newItem] })
    setShowExercisePicker(false)
    setSearch('')
  }

  const removeExercise = (itemId: string) => {
    if (!session) return
    updateSession({
      ...session,
      items: session.items.filter(it => it.id !== itemId)
    })
  }

  const addSet = (itemIndex: number) => {
    if (!session) return
    const newItems = [...session.items]
    const item = { ...newItems[itemIndex] }
    const lastSet = item.sets[item.sets.length - 1]
    // A manually added set is an intentional action, so it starts 'done'.
    item.sets = [
      ...item.sets,
      {
        id: crypto.randomUUID(),
        set_number: item.sets.length + 1,
        status: 'done',
        reps: lastSet?.reps ?? null,
        weight_kg: lastSet?.weight_kg ?? null,
        duration_s: null,
        distance_m: null,
        rpe: null,
        notes: null,
        extra: {},
      },
    ]
    newItems[itemIndex] = item
    updateSession({ ...session, items: newItems })
  }

  const updateSet = (itemIndex: number, setIndex: number, field: 'weight_kg' | 'reps', value: number | null) => {
    if (!session) return
    const newItems = [...session.items]
    const sets = [...newItems[itemIndex].sets]
    const prev = sets[setIndex]
    const nextReps = field === 'reps' ? value : prev.reps
    const nextWeight = field === 'weight_kg' ? value : prev.weight_kg
    const status = nextReps === null && nextWeight === null ? 'skipped' : 'done'
    sets[setIndex] = { ...prev, [field]: value, status }
    newItems[itemIndex] = { ...newItems[itemIndex], sets }
    updateSession({ ...session, items: newItems })
  }

  const removeSet = (itemIndex: number, setIndex: number) => {
    if (!session) return
    const newItems = session.items.map((it, i) => {
      if (i !== itemIndex) return it
      const sets = it.sets
        .filter((_, j) => j !== setIndex)
        .map((s, j) => ({ ...s, set_number: j + 1 }))
      return { ...it, sets }
    })
    updateSession({ ...session, items: newItems })
  }

  const filteredExercises = search.trim()
    ? exercises.filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()))
    : exercises

  return (
    <main className="animate-fade-in app-main-layout">
      <header className="header-area">
        <h1>Kratos</h1>
        <div className="flex-row" style={{ justifyContent: 'center', marginTop: '0.5rem' }}>
          <span className={`status-badge ${status.kind === 'busy' ? 'syncing' : status.kind === 'error' ? 'error' : ''}`}>
            {status.kind === 'busy'
              ? 'Syncing...'
              : status.kind === 'error'
                ? 'Offline — data saved locally'
                : queued === 0
                  ? 'All synced'
                  : `${queued} pending`}
          </span>
          {queued > 0 && (
            <button className="btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={sync} disabled={status.kind === 'busy'}>
              Force Sync
            </button>
          )}
        </div>
        {status.kind === 'error' && status.message && (
          <p style={{ color: 'var(--danger-color)', marginTop: '0.5rem' }}>{status.message}</p>
        )}
      </header>

      {/* In-progress Banner when not on Train tab */}
      {session && activeTab !== 'train' && (
        <div
          className="glass-panel active-workout-banner animate-slide-up"
          onClick={() => setActiveTab('train')}
          style={{ cursor: 'pointer', marginBottom: '1.25rem', borderColor: 'var(--primary-color)' }}
        >
          <div className="flex-between">
            <div className="flex-row" style={{ gap: '0.75rem', alignItems: 'center' }}>
              <span className="pulsing-green-dot" />
              <div>
                <strong style={{ fontSize: '0.95rem', color: '#fff', display: 'block' }}>
                  Workout In Progress
                </strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {(session.extra?.routine_name as string) || 'Free Workout'} • Tap to resume
                </span>
              </div>
            </div>
            <button className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}>
              Resume →
            </button>
          </div>
        </div>
      )}

      {/* View: Train */}
      {activeTab === 'train' && (
        <>
          {!session ? (
            <section className="glass-panel animate-slide-up">
              <div className="flex-col" style={{ alignItems: 'center', textAlign: 'center', padding: '2rem 0' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '1rem'
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#gradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#60a5fa" />
                        <stop offset="100%" stopColor="#c084fc" />
                      </linearGradient>
                    </defs>
                    <path d="M6 18h12"></path>
                    <path d="M6 14h12"></path>
                    <rect width="18" height="8" x="3" y="2" rx="2"></rect>
                  </svg>
                </div>
                <h2>Ready to train?</h2>
                {routines.length > 0 ? (
                  <>
                    <p style={{ marginBottom: '1.25rem' }}>Pick today&rsquo;s planned workout, then log your actuals.</p>
                    <div className="flex-col" style={{ gap: '0.75rem', width: '100%', maxWidth: '420px' }}>
                      {routines.map((routine) => (
                        <button
                          key={routine.id}
                          className="btn-primary"
                          onClick={() => startSession(routine)}
                          style={{ padding: '0.9rem 1.25rem', fontSize: '1rem', width: '100%' }}
                        >
                          <span style={{ display: 'block', fontWeight: 600 }}>{routine.name}</span>
                          {routine.items.length > 0 && (
                            <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.85, marginTop: '0.15rem' }}>
                              {routine.items.length} exercises planned
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        className="btn-secondary"
                        onClick={() => startSession()}
                        style={{ padding: '0.6rem 1rem', fontSize: '0.85rem' }}
                      >
                        Start empty session
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ marginBottom: '1.5rem' }}>Start an empty session and log as you go.</p>
                    <button className="btn-primary" onClick={() => startSession()} style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
                      Start Workout
                    </button>
                  </>
                )}
              </div>
            </section>
          ) : (
            <section className="animate-slide-up">
              <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
                <h2>Current Workout</h2>
                <div className="status-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success-color)' }}>
                  In progress
                </div>
              </div>
              
              <div className="glass-panel">
                {session.items.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                    <p>No exercises added yet.</p>
                  </div>
                ) : (
                  <div className="flex-col" style={{ gap: '2rem' }}>
                    {session.items.map((item, itemIdx) => {
                      const exercise = exercises.find(e => e.id === item.exercise_id)
                      const targetReps = (item.extra?.target_reps as number | null) ?? null
                      const targetWeight = (item.extra?.target_weight_kg as number | null) ?? null
                      return (
                        <div key={item.id} className="workout-item">
                          <div className="flex-between" style={{ marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{exercise?.name || 'Unknown Exercise'}</h3>
                            <button className="btn-icon btn-danger" onClick={() => removeExercise(item.id)} title="Remove Exercise">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                          </div>
                          
                          <div className="flex-col" style={{ gap: '0.75rem' }}>
                            {item.sets.length > 0 && (
                              <div className="set-row" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingBottom: '0.25rem' }}>
                                <div style={{ textAlign: 'center' }}>SET</div>
                                <div>KG</div>
                                <div>REPS</div>
                                <div></div>
                              </div>
                            )}
                            
                            {item.sets.map((set, setIdx) => (
                              <div key={set.id} className="set-row">
                                <div className="set-number">{set.set_number}</div>
                                <input 
                                  type="number" 
                                  step="0.5"
                                  placeholder={targetWeight !== null ? String(targetWeight) : 'Weight'} 
                                  value={set.weight_kg !== null ? set.weight_kg : ''} 
                                  onChange={(e) => updateSet(itemIdx, setIdx, 'weight_kg', e.target.value ? parseFloat(e.target.value) : null)}
                                />
                                <input 
                                  type="number" 
                                  placeholder={targetReps !== null ? String(targetReps) : 'Reps'} 
                                  value={set.reps !== null ? set.reps : ''} 
                                  onChange={(e) => updateSet(itemIdx, setIdx, 'reps', e.target.value ? parseInt(e.target.value) : null)}
                                />
                                <button className="btn-icon btn-secondary" onClick={() => removeSet(itemIdx, setIdx)}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                          
                          <button className="btn-secondary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => addSet(itemIdx)}>
                            + Add Set
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                
                <div className="flex-col" style={{ gap: '1rem', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--surface-border)' }}>
                  <button className="btn-secondary" onClick={() => setShowExercisePicker(true)} style={{ padding: '1rem' }}>
                    + Add Exercise
                  </button>
                  <button className="btn-primary" onClick={finishSession} style={{ padding: '1rem' }}>
                    Finish Workout
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* View: Week */}
      {activeTab === 'week' && (
        <WeekView
          routines={routines}
          sessions={sessions}
          onStartRoutine={(routine) => {
            startSession(routine)
            setActiveTab('train')
          }}
        />
      )}

      {/* View: History */}
      {activeTab === 'history' && (
        <HistoryView
          sessions={sessions}
          exercises={exercises}
          onUpdateSession={handleUpdateSession}
          onDeleteSession={handleDeleteSession}
          onRefresh={loadSessions}
          loading={loadingHistory}
        />
      )}

      {/* Exercise Picker Modal */}
      {showExercisePicker && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowExercisePicker(false) }}>
          <div className="modal-content animate-slide-up">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Select Exercise</h2>
              <button className="btn-icon btn-secondary" onClick={() => setShowExercisePicker(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <input
              type="text"
              placeholder="Search exercises..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: '1rem' }}
            />
            
            {exercises.length === 0 ? (
              status.kind === 'error' ? (
                <p style={{ textAlign: 'center', padding: '2rem' }}>Couldn't load exercises — check your connection and try again.</p>
              ) : (
                <p style={{ textAlign: 'center', padding: '2rem' }}>No exercises found. Add some to the database first.</p>
              )
            ) : filteredExercises.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem' }}>No exercises match your search.</p>
            ) : (
              <ul className="exercise-list">
                {filteredExercises.map(exercise => (
                  <li key={exercise.id} className="exercise-item" onClick={() => addExerciseToSession(exercise)}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exercise.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {exercise.primary_muscles.join(', ')}
                      </div>
                    </div>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        hasActiveWorkout={session !== null}
      />
    </main>
  )
}
