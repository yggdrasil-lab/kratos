import { useEffect, useState } from 'react'
import { StatusBadge, PwaUpdateBanner, AppHeader, SessionExpiredBanner, SessionExpiredError } from '@yggdrasil-lab/ui'
import { api } from './api'
import { db, requestPersistence } from './db'
import { enqueue, flush, newId, pending } from './outbox'
import type {
  ActiveTab,
  DailyBiometrics,
  EffortRating,
  Exercise,
  FastingCheckIn,
  FastingRecommendation,
  Routine,
  SessionItemPayload,
  SessionPayload,
  WorkoutRecommendation,
} from './types'
import { BottomNav } from './components/BottomNav'
import { EffortDebriefModal } from './components/EffortDebriefModal'
import { ProgressView } from './components/ProgressView'
import { TodayView } from './components/TodayView'
import { getCircadianDate, getCircadianDayOfWeek } from './utils/circadian'
import { usePwaUpdate } from './utils/pwa'
import { reportClientError } from './utils/telemetry'

type Status = { kind: 'idle' | 'busy' | 'error'; message?: string }

const DRAFT_KEY = 'current'

function parseServerFasting(fb?: DailyBiometrics['fasting']): FastingCheckIn | undefined {
  if (!fb || !fb.date) return undefined
  const payload = fb.payload || {}
  return {
    id: fb.id || `server-${fb.date}`,
    date: fb.date,
    target_window: (payload.target_window as string) || '16:8',
    adherence: (fb.rating as 'completed' | 'early' | 'off_plan') || 'completed',
    energy: (payload.energy as 'high' | 'normal' | 'low') || 'normal',
    headache: (payload.headache as 'none' | 'mild' | 'sugar_spike') || 'none',
    notes: fb.notes || null,
    logged_at: fb.logged_at || new Date().toISOString(),
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [sessionExpired, setSessionExpired] = useState<boolean>(false)
  const [queued, setQueued] = useState<number>(0)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [sessions, setSessions] = useState<SessionPayload[]>([])
  const [biometrics, setBiometrics] = useState<DailyBiometrics | null>(null)
  const [fastingRecommendation, setFastingRecommendation] = useState<FastingRecommendation | null>(null)
  const [workoutRecommendation, setWorkoutRecommendation] = useState<WorkoutRecommendation | null>(null)
  const [fastingLogs, setFastingLogs] = useState<FastingCheckIn[]>([])
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [showExercisePicker, setShowExercisePicker] = useState<boolean>(false)
  const [showDebriefModal, setShowDebriefModal] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')

  // Held in state (not recomputed per render) so a foreground/rollover can refresh it.
  const [circadianDate, setCircadianDate] = useState(() => getCircadianDate())
  const [dayOfWeek, setDayOfWeek] = useState(() => getCircadianDayOfWeek())
  const {
    needRefresh,
    applyUpdate,
    dismissUpdate,
  } = usePwaUpdate()

  const sync = async () => {
    setStatus({ kind: 'busy', message: 'Syncing…' })
    try {
      const left = await flush()
      setQueued(left)
      setStatus(
        left === 0
          ? { kind: 'idle', message: 'Up to date.' }
          : { kind: 'error', message: `${left} still queued - will sync when online.` }
      )
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Sync failed',
      })
    }
  }

  const refreshQueueCount = async () => {
    try {
      const items = await pending()
      setQueued(items.length)
    } catch {
      // ignore
    }
  }

  const loadSessions = async () => {
    try {
      const data = await api.sessions(50, 0)
      setSessions(data)
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
        setStatus({
          kind: 'error',
          message: 'Authentik session expired - tap to re-authenticate',
        })
      }
      const queuedSessions = await pending()
      if (queuedSessions.length > 0) {
        setSessions(queuedSessions.map((q) => q.payload))
      }
      void reportClientError(err, { source: 'sessions_fetch' })
    }
  }

  const loadBiometrics = async () => {
    try {
      const [data, rec, workoutRec] = await Promise.all([
        api.getBiometricsToday(),
        api.getFastingRecommendation(),
        api.getWorkoutRecommendation(),
      ])
      if (rec) {
        setFastingRecommendation(rec)
      }
      if (workoutRec) {
        setWorkoutRecommendation(workoutRec)
      }
      if (data) {
        setBiometrics(data)
        setSessionExpired(false)
        if (data.fasting) {
          const serverCheckIn = parseServerFasting(data.fasting)
          if (serverCheckIn) {
            try {
              await db.fastingLogs.put(serverCheckIn)
              setFastingLogs((prev) => [
                serverCheckIn,
                ...prev.filter((c) => c.date !== serverCheckIn.date),
              ])
            } catch {
              // Ignore IndexedDB put failure
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
        setStatus({
          kind: 'error',
          message: 'Authentik session expired - tap to re-authenticate',
        })
      } else {
        setStatus({
          kind: 'error',
          message: 'Failed to load biometrics',
        })
      }
      void reportClientError(err, { source: 'biometrics_fetch' })
    }
  }

  const loadFastingLogs = async () => {
    try {
      const logs = await db.fastingLogs.toArray()
      logs.sort((a, b) => b.logged_at.localeCompare(a.logged_at))
      setFastingLogs(logs)
    } catch {
      // ignore
    }
  }

  const loadCatalogue = async () => {
    try {
      const cached = await db.exercises.toArray()
      if (cached.length > 0) {
        setExercises(cached)
      }
    } catch {
      // Ignore IndexedDB read failure
    }

    try {
      const fresh = await api.exercises()
      setExercises(fresh)
      try {
        await db.transaction('rw', db.exercises, async () => {
          await db.exercises.clear()
          await db.exercises.bulkPut(fresh)
        })
      } catch {
        // Ignore IndexedDB write failure
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
      }
      const cachedCount = await db.exercises.count().catch(() => 0)
      if (cachedCount === 0) {
        setStatus({
          kind: 'error',
          message: err instanceof SessionExpiredError
            ? 'Authentik session expired - tap to re-authenticate'
            : 'Failed to fetch catalogue',
        })
      }
      void reportClientError(err, { source: 'catalogue_fetch' })
    }
  }

  const loadRoutines = async () => {
    try {
      const cached = await db.routines.toArray()
      if (cached.length > 0) {
        setRoutines(cached)
      }
    } catch {
      // Ignore IndexedDB read failure
    }

    try {
      const fresh = await api.routines()
      setRoutines(fresh)
      try {
        await db.transaction('rw', db.routines, async () => {
          await db.routines.clear()
          await db.routines.bulkPut(fresh)
        })
      } catch {
      // Ignore IndexedDB write failure
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
        setStatus({
          kind: 'error',
          message: 'Authentik session expired - tap to re-authenticate',
        })
      }
      void reportClientError(err, { source: 'routines_fetch' })
    }
  }

  const refreshCircadianClock = () => {
    setCircadianDate(getCircadianDate())
    setDayOfWeek(getCircadianDayOfWeek())
  }

  // Manual refresh (header button): re-evaluate the date and re-pull everything.
  const refreshAll = async () => {
    refreshCircadianClock()
    await Promise.all([
      sync(),
      loadBiometrics(),
      loadSessions(),
      loadCatalogue(),
      loadRoutines(),
    ])
  }

  useEffect(() => {
    requestPersistence()
    refreshQueueCount()

    db.drafts.get(DRAFT_KEY).then((draft) => {
      if (draft) setSession(draft.session)
    })

    void loadCatalogue()
    void loadRoutines()
    loadSessions()
    loadBiometrics()
    loadFastingLogs()

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshCircadianClock()
        void sync()
        void loadBiometrics()
        void loadSessions()
        void loadCatalogue()
        void loadRoutines()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    // Catch the circadian rollover while the app stays open (setState bails out on
    // an unchanged value, so this only re-renders when the date actually changes).
    const clockTimer = window.setInterval(refreshCircadianClock, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(clockTimer)
    }
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
    const id = newId()
    const started_at = new Date().toISOString()
    const items: SessionItemPayload[] = (routine?.items ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((it, idx) => {
        const recEx = workoutRecommendation?.exercises?.find((re) => {
          if (re.exercise_id && re.exercise_id === it.exercise_id) return true
          const ex = exercises.find((e) => e.id === it.exercise_id)
          return ex && ex.name.toLowerCase() === re.exercise_name.toLowerCase()
        })
        const targetSets = recEx?.target_sets ?? it.target_sets ?? 2
        const targetReps = recEx?.target_reps ?? it.target_reps ?? null
        const targetWeight = recEx?.suggested_weight_kg ?? it.target_weight_kg ?? null
        return {
          id: newId(),
          exercise_id: it.exercise_id,
          position: idx,
          notes: recEx?.notes || it.notes,
          extra: {
            target_sets: targetSets,
            target_reps: targetReps,
            target_weight_kg: targetWeight,
            target_duration_s: it.target_duration_s,
          },
          sets: Array.from({ length: targetSets }, (_, setIdx) => ({
            id: newId(),
            set_number: setIdx + 1,
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
    setActiveTab('today')
  }

  const promptFinishSession = () => {
    if (!session) return
    setShowDebriefModal(true)
  }

  const completeDebriefAndSave = async (
    effort: EffortRating,
    tags: string[],
    notes: string
  ) => {
    if (!session) return
    const ended_at = new Date().toISOString()
    const existingExtra = session.extra || {}
    const finalSession: SessionPayload = {
      ...session,
      ended_at,
      notes: notes || session.notes,
      extra: {
        ...existingExtra,
        effort_rating: effort,
        effort_tags: tags,
      },
    }
    updateSession(null)
    setShowDebriefModal(false)
    await enqueue(finalSession)

    // Bridge workout debrief feedback to Eir
    try {
      const routine = routines.find((r) => r.id === session.routine_id)
      const duration = session.started_at
        ? Math.round((new Date(ended_at).getTime() - new Date(session.started_at).getTime()) / 60000)
        : undefined
      const totalVolume = session.items.reduce((sum, item) => {
        return (
          sum +
          item.sets.reduce(
            (setSum, s) =>
              setSum + (s.status === 'done' && s.reps && s.weight_kg ? s.reps * s.weight_kg : 0),
            0
          )
        )
      }, 0)
      const completedSets = session.items.reduce(
        (sum, item) => sum + item.sets.filter((s) => s.status === 'done').length,
        0
      )
      const sessionDate = (session.started_at || ended_at).split('T')[0]

      api.saveWorkoutFeedback({
        date: sessionDate,
        routine_name: routine?.name,
        duration_minutes: duration,
        total_volume_kg: totalVolume,
        completed_sets: completedSets,
        effort_rating: effort,
        tags,
        notes: notes || undefined,
        logged_at: ended_at,
      })
    } catch {
      // Best-effort bridge forward
    }

    await sync()
    await loadSessions()
    setActiveTab('today')
  }

  const skipDebriefAndSave = async () => {
    if (!session) return
    const ended_at = new Date().toISOString()
    const finalSession = { ...session, ended_at }
    updateSession(null)
    setShowDebriefModal(false)
    await enqueue(finalSession)
    await sync()
    await loadSessions()
    setActiveTab('today')
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId)
    } catch {
      await db.outbox.delete(sessionId)
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    await refreshQueueCount()
  }

  const handleSaveFastingCheckIn = async (checkIn: FastingCheckIn) => {
    try {
      await db.fastingLogs.put(checkIn)
      setFastingLogs((prev) => [checkIn, ...prev.filter((c) => c.id !== checkIn.id)])
      await api.saveFastingCheckIn(checkIn)
    } catch {
      // Offline fallback
    }
  }

  const handleSynthesizeFastingRecommendation = async (customContext?: string) => {
    try {
      const updated = await api.synthesizeFastingRecommendation(customContext, circadianDate)
      if (updated) {
        setFastingRecommendation(updated)
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
      }
      void reportClientError(err, { source: 'fasting_synthesis' })
    }
  }

  const handleSynthesizeWorkoutRecommendation = async (customContext?: string) => {
    try {
      const updated = await api.synthesizeWorkoutRecommendation(customContext, circadianDate)
      if (updated) {
        setWorkoutRecommendation(updated)
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
      }
      void reportClientError(err, { source: 'workout_synthesis' })
    }
  }

  const addExerciseToSession = (exercise: Exercise) => {
    if (!session) return
    const newItem: SessionItemPayload = {
      id: newId(),
      exercise_id: exercise.id,
      position: session.items.length,
      notes: null,
      extra: {},
      sets: [
        {
          id: newId(),
          set_number: 1,
          status: 'skipped',
          reps: null,
          weight_kg: null,
          duration_s: null,
          distance_m: null,
          rpe: null,
          notes: null,
          extra: {},
        },
      ],
    }
    updateSession({ ...session, items: [...session.items, newItem] })
    setShowExercisePicker(false)
    setSearch('')
  }

  const removeExercise = (itemId: string) => {
    if (!session) return
    updateSession({
      ...session,
      items: session.items.filter((it) => it.id !== itemId),
    })
  }

  const addSet = (itemIndex: number) => {
    if (!session) return
    const newItems = [...session.items]
    const item = { ...newItems[itemIndex] }
    const lastSet = item.sets[item.sets.length - 1]
    item.sets = [
      ...item.sets,
      {
        id: newId(),
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

  const updateSet = (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    value: number | null
  ) => {
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
    ? exercises.filter((e) =>
        e.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : exercises

  const serverFastingToday = parseServerFasting(biometrics?.fasting)
  const todayFastingCheckIn =
    fastingLogs.find((f) => f.date === circadianDate) ||
    (serverFastingToday?.date === circadianDate ? serverFastingToday : undefined)

  return (
    <>
      <AppHeader
        variant="blue"
        brandIcon={
          <img
            src="/favicon.svg"
            alt="Kratos"
            className="w-full h-full object-contain rounded-xl"
          />
        }
        brandColor="overflow-hidden p-0 border border-sky-500/30"
        title="Kratos"
        subtitle="Strength & Circadian"
        onRefresh={() => void refreshAll()}
        isRefreshing={status.kind === 'busy'}
        actions={
          <div className="flex items-center space-x-2">
            <StatusBadge
              label={
                status.kind === 'busy'
                  ? 'Syncing...'
                  : status.kind === 'error'
                  ? status.message ?? 'Offline - data saved locally'
                  : queued === 0
                  ? 'All synced'
                  : `${queued} pending`
              }
              variant={
                status.kind === 'busy'
                  ? 'busy'
                  : status.kind === 'error'
                  ? 'error'
                  : queued === 0
                  ? 'success'
                  : 'warning'
              }
              isPulsing={status.kind === 'busy'}
              className={status.kind === 'busy' ? 'syncing' : status.kind === 'error' ? 'error' : ''}
            />
            {queued > 0 && (
              <button
                className="btn-secondary"
                style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                onClick={sync}
                disabled={status.kind === 'busy'}
              >
                Force Sync
              </button>
            )}
          </div>
        }
      />

      <main className="animate-fade-in app-main-layout">
        {sessionExpired && (
          <SessionExpiredBanner className="mb-4" />
        )}
        {status.kind === 'error' && status.message && !sessionExpired && (
          <p style={{ color: 'var(--danger-color)', marginBottom: '1rem', textAlign: 'center' }}>{status.message}</p>
        )}
        {needRefresh && (
          <PwaUpdateBanner
            onReload={applyUpdate}
            onDismiss={dismissUpdate}
            className="mb-4"
          />
        )}

        {/* ACTIVE WORKOUT LOGGING SCREEN */}
        {session ? (
          <section className="animate-slide-up">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2>{(session.extra?.routine_name as string) || 'Current Workout'}</h2>
                <div
                  className="status-badge"
                  style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success-color)' }}
                >
                  In progress
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => updateSession(null)}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              >
                Discard
              </button>
            </div>

            <div className="glass-panel">
              {session.items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                  <p>No exercises added yet.</p>
                </div>
              ) : (
                <div className="flex-col" style={{ gap: '2rem' }}>
                  {session.items.map((item, itemIdx) => {
                    const exercise = exercises.find((e) => e.id === item.exercise_id)
                    const targetReps = (item.extra?.target_reps as number | null) ?? null
                    const targetWeight = (item.extra?.target_weight_kg as number | null) ?? null
                    return (
                      <div key={item.id} className="workout-item">
                        <div className="flex-between" style={{ marginBottom: '1rem' }}>
                          <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>
                            {exercise?.name || 'Unknown Exercise'}
                          </h3>
                          <button
                            className="btn-icon btn-danger"
                            onClick={() => removeExercise(item.id)}
                            title="Remove Exercise"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>

                        <div className="flex-col" style={{ gap: '0.75rem' }}>
                          {item.sets.length > 0 && (
                            <div className="set-row" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingBottom: '0.25rem' }}>
                              <div style={{ textAlign: 'center' }}>SET</div>
                              <div style={{ textAlign: 'center' }}>KG</div>
                              <div style={{ textAlign: 'center' }}>REPS</div>
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
                                onChange={(e) =>
                                  updateSet(itemIdx, setIdx, 'weight_kg', e.target.value ? parseFloat(e.target.value) : null)
                                }
                              />
                              <input
                                type="number"
                                placeholder={targetReps !== null ? String(targetReps) : 'Reps'}
                                value={set.reps !== null ? set.reps : ''}
                                onChange={(e) =>
                                  updateSet(itemIdx, setIdx, 'reps', e.target.value ? parseInt(e.target.value) : null)
                                }
                              />
                              <button
                                className="btn-icon btn-secondary"
                                onClick={() => removeSet(itemIdx, setIdx)}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18"></path>
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                </svg>
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
                <button
                  className="btn-primary"
                  onClick={promptFinishSession}
                  style={{ padding: '1rem', fontSize: '1.05rem', fontWeight: 700 }}
                >
                  Finish Workout
                </button>
              </div>
            </div>
          </section>
        ) : (
          /* DASHBOARD TABS (WHEN NOT IN WORKOUT) */
          <>
            {activeTab === 'progress' || activeTab === 'history' ? (
              <ProgressView
                sessions={sessions}
                exercises={exercises}
                fastingLogs={fastingLogs}
                biometrics={biometrics}
                onDeleteSession={handleDeleteSession}
              />
            ) : (
              <TodayView
                circadianDate={circadianDate}
                dayOfWeek={dayOfWeek}
                biometrics={biometrics}
                fastingRecommendation={fastingRecommendation}
                workoutRecommendation={workoutRecommendation}
                routines={routines}
                exercises={exercises}
                sessions={sessions}
                latestFastingCheckIn={todayFastingCheckIn}
                onStartRoutine={startSession}
                onSaveFastingCheckIn={handleSaveFastingCheckIn}
                onSynthesizeFastingRecommendation={handleSynthesizeFastingRecommendation}
                onSynthesizeWorkoutRecommendation={handleSynthesizeWorkoutRecommendation}
              />
            )}
          </>
        )}
      </main>

      {/* Post-Workout Effort Debrief Modal */}
      {showDebriefModal && session && (
        <EffortDebriefModal
          session={session}
          exercises={exercises}
          onSave={completeDebriefAndSave}
          onSkip={skipDebriefAndSave}
        />
      )}

      {/* Exercise Picker Modal */}
      {showExercisePicker && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowExercisePicker(false)
          }}
        >
          <div className="modal-content animate-slide-up">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Select Exercise</h2>
              <button className="btn-icon btn-secondary" onClick={() => setShowExercisePicker(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
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
                <p style={{ textAlign: 'center', padding: '2rem' }}>
                  Couldn't load exercises - check your connection and try again.
                </p>
              ) : (
                <p style={{ textAlign: 'center', padding: '2rem' }}>
                  No exercises found. Add some to the database first.
                </p>
              )
            ) : filteredExercises.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem' }}>No exercises match your search.</p>
            ) : (
              <ul className="exercise-list">
                {filteredExercises.map((exercise) => (
                  <li key={exercise.id} className="exercise-item" onClick={() => addExerciseToSession(exercise)}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{exercise.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {exercise.primary_muscles.join(', ')}
                      </div>
                    </div>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
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
    </>
  )
}
