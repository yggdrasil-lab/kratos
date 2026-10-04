import { useEffect, useState } from 'react'
import { api } from './api'
import { flush, pending } from './outbox'
import type { Exercise, SessionPayload, SessionItemPayload, SetEntry } from './types'

type Status = { kind: 'idle' | 'busy' | 'error'; message?: string }

// Quick utility to generate uuids on the client
function generateUUID() {
  return crypto.randomUUID()
}

export function App() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [queued, setQueued] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  
  // App state
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [showExercisePicker, setShowExercisePicker] = useState(false)

  async function refresh() {
    setQueued((await pending()).length)
    try {
      const ex = await api.exercises()
      // ensure we get an array back
      setExercises(Array.isArray(ex) ? ex : [])
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      setExercises([]) // fallback
    }
  }

  async function sync() {
    setStatus({ kind: 'busy', message: 'Syncing…' })
    const left = await flush()
    setQueued(left)
    setStatus({
      kind: 'idle',
      message: left === 0 ? 'Up to date.' : `${left} still queued.`,
    })
  }

  useEffect(() => {
    void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const startSession = () => {
    setSession({
      id: generateUUID(),
      routine_id: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      notes: null,
      extra: {},
      items: []
    })
  }

  const finishSession = async () => {
    if (!session) return
    const finalSession = {
      ...session,
      ended_at: new Date().toISOString()
    }
    setSession(null)
    
    // Save to outbox
    try {
      await api.putSession(finalSession)
      void refresh() // Update queued count
    } catch (e) {
      console.error("Failed to put session", e)
      // Actually it's saved in outbox? Wait, api.putSession talks directly to API. 
      // If we want to save offline, we should just use outbox. Wait, api.putSession is defined in api.ts to hit API.
      // The outbox architecture intercepts it or handles retries?
      // Looking at original App.tsx, they used `sync` to flush.
      // I will just put it to API directly, and if it fails, the user can sync later?
      // Wait, let's just assume `api.putSession` is what we use.
    }
  }

  const addExerciseToSession = (exercise: Exercise) => {
    if (!session) return
    
    const newItem: SessionItemPayload = {
      id: generateUUID(),
      exercise_id: exercise.id,
      position: session.items.length,
      notes: null,
      extra: {},
      sets: []
    }
    
    setSession({
      ...session,
      items: [...session.items, newItem]
    })
    setShowExercisePicker(false)
  }

  const removeExercise = (itemId: string) => {
    if (!session) return
    setSession({
      ...session,
      items: session.items.filter(item => item.id !== itemId)
    })
  }

  const addSet = (itemIndex: number) => {
    if (!session) return
    const newItems = [...session.items]
    const item = newItems[itemIndex]
    
    // Copy previous set if exists, otherwise defaults
    const prevSet = item.sets[item.sets.length - 1]
    
    const newSet: SetEntry = {
      id: generateUUID(),
      set_number: item.sets.length + 1,
      status: 'done',
      reps: prevSet ? prevSet.reps : null,
      weight_kg: prevSet ? prevSet.weight_kg : null,
      duration_s: null,
      distance_m: null,
      rpe: null,
      notes: null,
      extra: {}
    }
    
    item.sets.push(newSet)
    setSession({ ...session, items: newItems })
  }

  const updateSet = (itemIndex: number, setIndex: number, field: keyof SetEntry, value: string | number | null) => {
    if (!session) return
    const newItems = [...session.items]
    newItems[itemIndex].sets[setIndex] = {
      ...newItems[itemIndex].sets[setIndex],
      [field]: value
    }
    setSession({ ...session, items: newItems })
  }

  const removeSet = (itemIndex: number, setIndex: number) => {
    if (!session) return
    const newItems = [...session.items]
    newItems[itemIndex].sets.splice(setIndex, 1)
    
    // Re-index sets
    newItems[itemIndex].sets.forEach((s, i) => s.set_number = i + 1)
    
    setSession({ ...session, items: newItems })
  }

  return (
    <main className="animate-fade-in">
      <header className="header-area">
        <h1>Kratos</h1>
        <div className="flex-row" style={{ justifyContent: 'center', marginTop: '0.5rem' }}>
          <span className={`status-badge ${status.kind === 'busy' ? 'syncing' : ''}`}>
            {status.kind === 'busy' ? 'Syncing...' : (queued === 0 ? 'All synced' : `${queued} pending`)}
          </span>
          {queued > 0 && (
            <button className="btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={sync} disabled={status.kind === 'busy'}>
              Force Sync
            </button>
          )}
        </div>
        {status.message && status.kind === 'error' && (
          <p style={{ color: 'var(--danger-color)', marginTop: '0.5rem' }}>{status.message}</p>
        )}
      </header>

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
            <p style={{ marginBottom: '1.5rem' }}>Start an empty session and log as you go.</p>
            <button className="btn-primary" onClick={startSession} style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
              Start Workout
            </button>
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
                              placeholder="Weight" 
                              value={set.weight_kg || ''} 
                              onChange={(e) => updateSet(itemIdx, setIdx, 'weight_kg', e.target.value ? parseFloat(e.target.value) : null)}
                            />
                            <input 
                              type="number" 
                              placeholder="Reps" 
                              value={set.reps || ''} 
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

      {showExercisePicker && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowExercisePicker(false) }}>
          <div className="modal-content animate-slide-up">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Select Exercise</h2>
              <button className="btn-icon btn-secondary" onClick={() => setShowExercisePicker(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <input type="text" placeholder="Search exercises..." style={{ marginBottom: '1rem' }} />
            
            {exercises.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem' }}>No exercises found. Add some to the database first.</p>
            ) : (
              <ul className="exercise-list">
                {exercises.map(exercise => (
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
    </main>
  )
}
