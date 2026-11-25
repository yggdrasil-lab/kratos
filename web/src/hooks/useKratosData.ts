import { useCallback, useEffect, useMemo, useState } from 'react'
import { clearBrowserCaches, isSessionExpiredError, useAppResumeRefresh } from '@yggdrasil-lab/ui'
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
  SplitSegmentInput,
  WorkoutRecommendation,
} from '../types'
import { getCircadianDate, getCircadianDayOfWeek, parseServerFasting } from '../utils/circadian'
import { computeSessionVolumeAndSets } from '../utils/session'
import { reportClientError } from '../utils/telemetry'

export type SyncStatus = { kind: 'idle' | 'busy' | 'error'; message?: string }

const SESSION_EXPIRED_MESSAGE = 'Authentik session expired - tap to re-authenticate'

function sortByStartedDesc(a: SessionPayload, b: SessionPayload): number {
  const timeA = new Date(a.started_at || 0).getTime()
  const timeB = new Date(b.started_at || 0).getTime()
  return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA)
}

function mergeSessionsById(
  serverSessions: SessionPayload[],
  queuedItems: { payload: SessionPayload }[]
): SessionPayload[] {
  const mergedById = new Map<string, SessionPayload>()
  for (const s of serverSessions) mergedById.set(s.id, s)
  for (const q of queuedItems) mergedById.set(q.payload.id, q.payload)
  return Array.from(mergedById.values()).sort(sortByStartedDesc)
}

async function sendWorkoutFeedbackBestEffort(
  finalSession: SessionPayload,
  feedback: { effort: EffortRating; tags: string[]; notes: string },
  routines: Routine[],
  exercises: Exercise[]
): Promise<void> {
  if (!finalSession.ended_at) return
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

function useCatalogueState(
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
) {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])

  const loadCatalogue = useCallback(async () => {
    const cached = await db.exercises.toArray().catch(() => [])
    if (cached.length > 0) setExercises(cached)
    try {
      const fresh = await api.exercises()
      setExercises(fresh)
      await db
        .transaction('rw', db.exercises, async () => {
          await db.exercises.clear()
          await db.exercises.bulkPut(fresh)
        })
        .catch(() => undefined)
    } catch (err) {
      if (isSessionExpiredError(err)) setSessionExpired(true)
      const cachedCount = await db.exercises.count().catch(() => 0)
      if (cachedCount === 0) {
        setStatus({
          kind: 'error',
          message:
            isSessionExpiredError(err) ? SESSION_EXPIRED_MESSAGE : 'Failed to fetch catalogue',
        })
      }
      void reportClientError(err, { source: 'catalogue_fetch' })
    }
  }, [setSessionExpired, setStatus])

  const loadRoutines = useCallback(async () => {
    const cached = await db.routines.toArray().catch(() => [])
    if (cached.length > 0) setRoutines(cached)
    try {
      const fresh = await api.routines()
      setRoutines(fresh)
      await db
        .transaction('rw', db.routines, async () => {
          await db.routines.clear()
          await db.routines.bulkPut(fresh)
        })
        .catch(() => undefined)
    } catch (err) {
      if (isSessionExpiredError(err)) {
        setSessionExpired(true)
        setStatus({ kind: 'error', message: SESSION_EXPIRED_MESSAGE })
      }
      void reportClientError(err, { source: 'routines_fetch' })
    }
  }, [setSessionExpired, setStatus])

  return { exercises, routines, loadCatalogue, loadRoutines }
}

function useRecommendationSynthesizers(
  circadianDate: string,
  setSessionExpired: (val: boolean) => void,
  setIsGeneratingFasting: (val: boolean) => void,
  setIsGeneratingWorkout: (val: boolean) => void,
  setFastingRecommendation: (val: FastingRecommendation | null) => void,
  setWorkoutRecommendation: (val: WorkoutRecommendation | null) => void
) {
  const synthesizeFastingRecommendation = useCallback(
    async (customContext?: string) => {
      setIsGeneratingFasting(true)
      try {
        const updated = await api.synthesizeFastingRecommendation(customContext, circadianDate)
        if (updated) setFastingRecommendation(updated)
      } catch (err) {
        if (isSessionExpiredError(err)) setSessionExpired(true)
        void reportClientError(err, { source: 'fasting_synthesis' })
        throw err
      } finally {
        setIsGeneratingFasting(false)
      }
    },
    [circadianDate, setSessionExpired, setIsGeneratingFasting, setFastingRecommendation]
  )

  const synthesizeWorkoutRecommendation = useCallback(
    async (customContext?: string) => {
      setIsGeneratingWorkout(true)
      try {
        const updated = await api.synthesizeWorkoutRecommendation(customContext, circadianDate)
        if (updated) setWorkoutRecommendation(updated)
      } catch (err) {
        if (isSessionExpiredError(err)) setSessionExpired(true)
        void reportClientError(err, { source: 'workout_synthesis' })
        throw err
      } finally {
        setIsGeneratingWorkout(false)
      }
    },
    [circadianDate, setSessionExpired, setIsGeneratingWorkout, setWorkoutRecommendation]
  )

  return { synthesizeFastingRecommendation, synthesizeWorkoutRecommendation }
}

function useBiometricsState(
  circadianDate: string,
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
) {
  const [biometrics, setBiometrics] = useState<DailyBiometrics | null>(null)
  const [fastingRecommendation, setFastingRecommendation] = useState<FastingRecommendation | null>(null)
  const [workoutRecommendation, setWorkoutRecommendation] = useState<WorkoutRecommendation | null>(null)
  const [isGeneratingFasting, setIsGeneratingFasting] = useState<boolean>(false)
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState<boolean>(false)
  const [fastingLogs, setFastingLogs] = useState<FastingCheckIn[]>([])

  const loadFastingLogs = useCallback(async () => {
    const logs = await db.fastingLogs.toArray().catch(() => [])
    logs.sort((a, b) => b.logged_at.localeCompare(a.logged_at))
    setFastingLogs(logs)
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
      if (!data) return
      setBiometrics(data)
      setSessionExpired(false)
      const serverCheckIn = parseServerFasting(data.fasting)
      if (serverCheckIn) {
        await db.fastingLogs.put(serverCheckIn).catch(() => undefined)
        setFastingLogs((prev) => [serverCheckIn, ...prev.filter((c) => c.date !== serverCheckIn.date)])
      }
    } catch (err) {
      const expired = isSessionExpiredError(err)
      if (expired) setSessionExpired(true)
      setStatus({ kind: 'error', message: expired ? SESSION_EXPIRED_MESSAGE : 'Failed to load biometrics' })
      void reportClientError(err, { source: 'biometrics_fetch' })
    } finally {
      setIsGeneratingFasting(false)
      setIsGeneratingWorkout(false)
    }
  }, [setSessionExpired, setStatus])

  const saveFastingCheckIn = useCallback(async (checkIn: FastingCheckIn) => {
    await db.fastingLogs.put(checkIn).catch(() => undefined)
    setFastingLogs((prev) => [checkIn, ...prev.filter((c) => c.id !== checkIn.id)])
    await api.saveFastingCheckIn(checkIn).catch(() => undefined)
  }, [])

  const synths = useRecommendationSynthesizers(
    circadianDate,
    setSessionExpired,
    setIsGeneratingFasting,
    setIsGeneratingWorkout,
    setFastingRecommendation,
    setWorkoutRecommendation
  )

  return {
    biometrics,
    fastingRecommendation,
    workoutRecommendation,
    isGeneratingFasting,
    isGeneratingWorkout,
    fastingLogs,
    loadBiometrics,
    loadFastingLogs,
    saveFastingCheckIn,
    ...synths,
  }
}

function useSessionMutations(
  sessions: SessionPayload[],
  setSessions: React.Dispatch<React.SetStateAction<SessionPayload[]>>,
  routines: Routine[],
  exercises: Exercise[],
  sync: () => Promise<void>,
  loadSessions: () => Promise<void>,
  refreshQueueCount: () => Promise<void>
) {
  const persistSession = useCallback(
    async (
      finalSession: SessionPayload,
      feedback?: { effort: EffortRating; tags: string[]; notes: string }
    ) => {
      await enqueue(finalSession)
      if (feedback) await sendWorkoutFeedbackBestEffort(finalSession, feedback, routines, exercises)
      await sync()
      await loadSessions()
    },
    [routines, exercises, sync, loadSessions]
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const target = sessions.find((s) => s.id === sessionId)
      try {
        await api.deleteSession(sessionId, Boolean(target?.extra?.inferred))
      } catch {
        await db.outbox.delete(sessionId)
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      await refreshQueueCount()
    },
    [sessions, setSessions, refreshQueueCount]
  )

  const confirmSession = useCallback(
    async (sessionId: string) => {
      const target = sessions.find((s) => s.id === sessionId)
      if (!target) return
      const updated: SessionPayload = {
        ...target,
        extra: { ...(target.extra || {}), inferred: false, confirmed: true },
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)))
      await enqueue(updated)
      await sync()
      await loadSessions()
    },
    [sessions, setSessions, sync, loadSessions]
  )

  const updateSessionRecord = useCallback(
    async (updatedSession: SessionPayload) => {
      setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)))
      await enqueue(updatedSession)
      await sync()
      await loadSessions()
    },
    [setSessions, sync, loadSessions]
  )

  const splitSessionRecord = useCallback(
    async (parentId: string, segments: SplitSegmentInput[]): Promise<SessionPayload[]> => {
      const res = await api.splitSession(parentId, segments)
      await db.outbox.delete(parentId).catch(() => undefined)
      setSessions((prev) => [...res.sessions, ...prev.filter((s) => s.id !== parentId)].sort(sortByStartedDesc))
      await refreshQueueCount()
      await loadSessions()
      return res.sessions
    },
    [setSessions, refreshQueueCount, loadSessions]
  )

  return { persistSession, deleteSession, confirmSession, updateSessionRecord, splitSessionRecord }
}

function useSessionsState(
  routines: Routine[],
  exercises: Exercise[],
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
) {
  const [queued, setQueued] = useState<number>(0)
  const [sessions, setSessions] = useState<SessionPayload[]>([])

  const refreshQueueCount = useCallback(async () => {
    const items = await pending().catch(() => null)
    if (items) setQueued(items.length)
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
      if (isSessionExpiredError(err)) {
        setSessionExpired(true)
        setStatus({ kind: 'error', message: SESSION_EXPIRED_MESSAGE })
        return
      }
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Sync failed' })
    }
  }, [setSessionExpired, setStatus])

  const loadSessions = useCallback(async () => {
    try {
      const [serverSessions, queuedItems] = await Promise.all([api.sessions(50, 0), pending()])
      setQueued(queuedItems.length)
      setSessions(mergeSessionsById(serverSessions, queuedItems))
    } catch (err) {
      if (isSessionExpiredError(err)) {
        setSessionExpired(true)
        setStatus({ kind: 'error', message: SESSION_EXPIRED_MESSAGE })
      }
      const queuedSessions = await pending()
      setQueued(queuedSessions.length)
      if (queuedSessions.length > 0) setSessions(queuedSessions.map((q) => q.payload).sort(sortByStartedDesc))
      void reportClientError(err, { source: 'sessions_fetch' })
    }
  }, [setSessionExpired, setStatus])

  const mutations = useSessionMutations(
    sessions,
    setSessions,
    routines,
    exercises,
    sync,
    loadSessions,
    refreshQueueCount
  )

  return { queued, sessions, sync, loadSessions, ...mutations }
}

function useRefreshLifecycle(refreshAll: () => Promise<void>, refreshCircadianClock: () => void) {
  useEffect(() => {
    void requestPersistence()
    void refreshAll()
    const clockTimer = window.setInterval(refreshCircadianClock, 60_000)
    return () => {
      window.clearInterval(clockTimer)
    }
  }, [refreshAll, refreshCircadianClock])

  useAppResumeRefresh(() => {
    void refreshAll()
  })
}

/**
 * Encapsulates Kratos IndexedDB caching, offline outbox sync, parallel API hydration,
 * circadian rollover clock, and server-synced mutations.
 */
export function useKratosData() {
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' })
  const [sessionExpired, setSessionExpired] = useState<boolean>(false)
  const [circadianDate, setCircadianDate] = useState(() => getCircadianDate())
  const [dayOfWeek, setDayOfWeek] = useState(() => getCircadianDayOfWeek())

  const refreshCircadianClock = useCallback(() => {
    setCircadianDate(getCircadianDate())
    setDayOfWeek(getCircadianDayOfWeek())
  }, [])

  const catalogue = useCatalogueState(setSessionExpired, setStatus)
  const biometricsState = useBiometricsState(circadianDate, setSessionExpired, setStatus)
  const sessionsState = useSessionsState(catalogue.routines, catalogue.exercises, setSessionExpired, setStatus)

  const refreshAll = useCallback(async () => {
    refreshCircadianClock()
    await clearBrowserCaches()
    await sessionsState.sync()
    await Promise.all([
      biometricsState.loadBiometrics(),
      sessionsState.loadSessions(),
      catalogue.loadCatalogue(),
      catalogue.loadRoutines(),
      biometricsState.loadFastingLogs(),
    ])
  }, [
    refreshCircadianClock,
    sessionsState.sync,
    sessionsState.loadSessions,
    biometricsState.loadBiometrics,
    biometricsState.loadFastingLogs,
    catalogue.loadCatalogue,
    catalogue.loadRoutines,
  ])

  useRefreshLifecycle(refreshAll, refreshCircadianClock)

  const todayFastingCheckIn = useMemo(() => {
    const serverFastingToday = parseServerFasting(biometricsState.biometrics?.fasting)
    return (
      biometricsState.fastingLogs.find((f) => f.date === circadianDate) ||
      (serverFastingToday?.date === circadianDate ? serverFastingToday : undefined)
    )
  }, [biometricsState.fastingLogs, biometricsState.biometrics?.fasting, circadianDate])

  return {
    status,
    sessionExpired,
    queued: sessionsState.queued,
    exercises: catalogue.exercises,
    routines: catalogue.routines,
    sessions: sessionsState.sessions,
    biometrics: biometricsState.biometrics,
    fastingRecommendation: biometricsState.fastingRecommendation,
    workoutRecommendation: biometricsState.workoutRecommendation,
    isGeneratingFasting: biometricsState.isGeneratingFasting,
    isGeneratingWorkout: biometricsState.isGeneratingWorkout,
    fastingLogs: biometricsState.fastingLogs,
    circadianDate,
    dayOfWeek,
    todayFastingCheckIn,
    sync: sessionsState.sync,
    refreshAll,
    persistSession: sessionsState.persistSession,
    deleteSession: sessionsState.deleteSession,
    confirmSession: sessionsState.confirmSession,
    updateSessionRecord: sessionsState.updateSessionRecord,
    splitSessionRecord: sessionsState.splitSessionRecord,
    saveFastingCheckIn: biometricsState.saveFastingCheckIn,
    synthesizeFastingRecommendation: biometricsState.synthesizeFastingRecommendation,
    synthesizeWorkoutRecommendation: biometricsState.synthesizeWorkoutRecommendation,
  }
}
