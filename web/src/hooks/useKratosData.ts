import { useCallback, useEffect, useMemo, useState } from 'react'
import { SessionExpiredError } from '@yggdrasil-lab/ui'
import { api } from '../api'
import { db, requestPersistence } from '../db'
import { enqueue, flush, pending } from '../outbox'
import type {
  DailyBiometrics,
  EffortRating,
  Exercise,
  FastingCheckIn,
  FastingRecommendation,
  Routine,
  SessionPayload,
  WorkoutRecommendation,
} from '../types'
import { getCircadianDate, getCircadianDayOfWeek, parseServerFasting } from '../utils/circadian'
import { computeSessionVolumeAndSets } from '../utils/session'
import { reportClientError } from '../utils/telemetry'

export type SyncStatus = { kind: 'idle' | 'busy' | 'error'; message?: string }

const SESSION_EXPIRED_MESSAGE = 'Authentik session expired - tap to re-authenticate'

/**
 * Encapsulates Kratos IndexedDB caching, offline outbox sync, parallel API hydration,
 * circadian rollover clock, and server-synced mutations.
 */
export function useKratosData() {
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' })
  const [sessionExpired, setSessionExpired] = useState<boolean>(false)
  const [queued, setQueued] = useState<number>(0)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [sessions, setSessions] = useState<SessionPayload[]>([])
  const [biometrics, setBiometrics] = useState<DailyBiometrics | null>(null)
  const [fastingRecommendation, setFastingRecommendation] = useState<FastingRecommendation | null>(null)
  const [workoutRecommendation, setWorkoutRecommendation] = useState<WorkoutRecommendation | null>(null)
  const [isGeneratingFasting, setIsGeneratingFasting] = useState<boolean>(false)
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState<boolean>(false)
  const [fastingLogs, setFastingLogs] = useState<FastingCheckIn[]>([])
  const [circadianDate, setCircadianDate] = useState(() => getCircadianDate())
  const [dayOfWeek, setDayOfWeek] = useState(() => getCircadianDayOfWeek())

  const refreshCircadianClock = useCallback(() => {
    setCircadianDate(getCircadianDate())
    setDayOfWeek(getCircadianDayOfWeek())
  }, [])

  const refreshQueueCount = useCallback(async () => {
    try {
      const items = await pending()
      setQueued(items.length)
    } catch {
      // Ignore IndexedDB count failures
    }
  }, [])

  const sync = useCallback(async () => {
    setStatus({ kind: 'busy', message: 'Syncing...' })
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
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.sessions(50, 0)
      setSessions(data)
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
        setStatus({ kind: 'error', message: SESSION_EXPIRED_MESSAGE })
      }
      const queuedSessions = await pending()
      if (queuedSessions.length > 0) {
        setSessions(queuedSessions.map((q) => q.payload))
      }
      void reportClientError(err, { source: 'sessions_fetch' })
    }
  }, [])

  const loadBiometrics = useCallback(async () => {
    setIsGeneratingFasting(true)
    setIsGeneratingWorkout(true)
    try {
      const [data, rec, workoutRec] = await Promise.all([
        api.getBiometricsToday(),
        api.getFastingRecommendation().finally(() => setIsGeneratingFasting(false)),
        api.getWorkoutRecommendation().finally(() => setIsGeneratingWorkout(false)),
      ])
      if (rec) setFastingRecommendation(rec)
      if (workoutRec) setWorkoutRecommendation(workoutRec)
      if (data) {
        setBiometrics(data)
        setSessionExpired(false)
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
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true)
        setStatus({ kind: 'error', message: SESSION_EXPIRED_MESSAGE })
      } else {
        setStatus({ kind: 'error', message: 'Failed to load biometrics' })
      }
      void reportClientError(err, { source: 'biometrics_fetch' })
    } finally {
      setIsGeneratingFasting(false)
      setIsGeneratingWorkout(false)
    }
  }, [])

  const loadFastingLogs = useCallback(async () => {
    try {
      const logs = await db.fastingLogs.toArray()
      logs.sort((a, b) => b.logged_at.localeCompare(a.logged_at))
      setFastingLogs(logs)
    } catch {
      // Ignore IndexedDB read failures
    }
  }, [])

  const loadCatalogue = useCallback(async () => {
    try {
      const cached = await db.exercises.toArray()
      if (cached.length > 0) setExercises(cached)
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
          message:
            err instanceof SessionExpiredError ? SESSION_EXPIRED_MESSAGE : 'Failed to fetch catalogue',
        })
      }
      void reportClientError(err, { source: 'catalogue_fetch' })
    }
  }, [])

  const loadRoutines = useCallback(async () => {
    try {
      const cached = await db.routines.toArray()
      if (cached.length > 0) setRoutines(cached)
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
        setStatus({ kind: 'error', message: SESSION_EXPIRED_MESSAGE })
      }
      void reportClientError(err, { source: 'routines_fetch' })
    }
  }, [])

  const refreshAll = useCallback(async () => {
    refreshCircadianClock()
    await Promise.all([
      sync(),
      loadBiometrics(),
      loadSessions(),
      loadCatalogue(),
      loadRoutines(),
    ])
  }, [refreshCircadianClock, sync, loadBiometrics, loadSessions, loadCatalogue, loadRoutines])

  useEffect(() => {
    void requestPersistence()
    void refreshQueueCount()
    void loadCatalogue()
    void loadRoutines()
    void loadSessions()
    void loadBiometrics()
    void loadFastingLogs()

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshAll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    const clockTimer = window.setInterval(refreshCircadianClock, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(clockTimer)
    }
  }, [
    refreshQueueCount,
    loadCatalogue,
    loadRoutines,
    loadSessions,
    loadBiometrics,
    loadFastingLogs,
    refreshAll,
    refreshCircadianClock,
  ])

  const persistSession = useCallback(
    async (
      finalSession: SessionPayload,
      feedback?: { effort: EffortRating; tags: string[]; notes: string }
    ) => {
      await enqueue(finalSession)

      if (feedback && finalSession.ended_at) {
        try {
          const routine = routines.find((r) => r.id === finalSession.routine_id)
          const duration = finalSession.started_at
            ? Math.round(
                (new Date(finalSession.ended_at).getTime() -
                  new Date(finalSession.started_at).getTime()) /
                  60000
              )
            : undefined
          const { volume: totalVolume, sets: completedSets } = computeSessionVolumeAndSets(
            finalSession,
            exercises
          )
          const sessionDate = (finalSession.started_at || finalSession.ended_at).split('T')[0]

          await api.saveWorkoutFeedback({
            date: sessionDate,
            routine_name: routine?.name,
            duration_minutes: duration,
            total_volume_kg: totalVolume,
            completed_sets: completedSets,
            effort_rating: feedback.effort,
            tags: feedback.tags,
            notes: feedback.notes || undefined,
            logged_at: finalSession.ended_at,
          })
        } catch {
          // Best-effort bridge forward
        }
      }

      await sync()
      await loadSessions()
    },
    [routines, exercises, sync, loadSessions]
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await api.deleteSession(sessionId)
      } catch {
        await db.outbox.delete(sessionId)
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      await refreshQueueCount()
    },
    [refreshQueueCount]
  )

  const confirmSession = useCallback(
    async (sessionId: string) => {
      const target = sessions.find((s) => s.id === sessionId)
      if (!target) return
      const updatedSession: SessionPayload = {
        ...target,
        extra: {
          ...(target.extra || {}),
          inferred: false,
          confirmed: true,
        },
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updatedSession : s)))
      await enqueue(updatedSession)
      await sync()
      await loadSessions()
    },
    [sessions, sync, loadSessions]
  )

  const updateSessionRecord = useCallback(
    async (updatedSession: SessionPayload) => {
      setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)))
      await enqueue(updatedSession)
      await sync()
      await loadSessions()
    },
    [sync, loadSessions]
  )

  const saveFastingCheckIn = useCallback(async (checkIn: FastingCheckIn) => {
    try {
      await db.fastingLogs.put(checkIn)
      setFastingLogs((prev) => [checkIn, ...prev.filter((c) => c.id !== checkIn.id)])
      await api.saveFastingCheckIn(checkIn)
    } catch {
      // Offline fallback
    }
  }, [])

  const synthesizeFastingRecommendation = useCallback(
    async (customContext?: string) => {
      setIsGeneratingFasting(true)
      try {
        const updated = await api.synthesizeFastingRecommendation(customContext, circadianDate)
        if (updated) setFastingRecommendation(updated)
      } catch (err) {
        if (err instanceof SessionExpiredError) setSessionExpired(true)
        void reportClientError(err, { source: 'fasting_synthesis' })
        throw err
      } finally {
        setIsGeneratingFasting(false)
      }
    },
    [circadianDate]
  )

  const synthesizeWorkoutRecommendation = useCallback(
    async (customContext?: string) => {
      setIsGeneratingWorkout(true)
      try {
        const updated = await api.synthesizeWorkoutRecommendation(customContext, circadianDate)
        if (updated) setWorkoutRecommendation(updated)
      } catch (err) {
        if (err instanceof SessionExpiredError) setSessionExpired(true)
        void reportClientError(err, { source: 'workout_synthesis' })
        throw err
      } finally {
        setIsGeneratingWorkout(false)
      }
    },
    [circadianDate]
  )

  const todayFastingCheckIn = useMemo(() => {
    const serverFastingToday = parseServerFasting(biometrics?.fasting)
    return (
      fastingLogs.find((f) => f.date === circadianDate) ||
      (serverFastingToday?.date === circadianDate ? serverFastingToday : undefined)
    )
  }, [fastingLogs, biometrics?.fasting, circadianDate])

  return {
    status,
    sessionExpired,
    queued,
    exercises,
    routines,
    sessions,
    biometrics,
    fastingRecommendation,
    workoutRecommendation,
    isGeneratingFasting,
    isGeneratingWorkout,
    fastingLogs,
    circadianDate,
    dayOfWeek,
    todayFastingCheckIn,
    sync,
    refreshAll,
    persistSession,
    deleteSession,
    confirmSession,
    updateSessionRecord,
    saveFastingCheckIn,
    synthesizeFastingRecommendation,
    synthesizeWorkoutRecommendation,
  }
}
