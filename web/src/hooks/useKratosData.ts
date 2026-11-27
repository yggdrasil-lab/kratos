import { useCallback, useEffect, useState } from 'react'
import { clearBrowserCaches, isSessionExpiredError, useAppResumeRefresh } from '@yggdrasil-lab/ui'
import { api, isKratosApiError } from '../api'
import { db, requestPersistence } from '../db'
import { enqueue, flush, pending } from '../outbox'
import type {
  DailyBiometrics,
  EffortRating,
  Exercise,
  Routine,
  SessionPayload,
  SplitSegmentInput,
  WorkoutRecommendation,
} from '../types'
import { getCircadianDate, getCircadianDayOfWeek } from '../utils/circadian'
import { computeSessionVolumeAndSets } from '../utils/session'
import { reportClientError } from '../utils/telemetry'

export type SyncStatus = { kind: 'idle' | 'busy' | 'error'; message?: string }

const SESSION_EXPIRED_MESSAGE = 'Authentik session expired - tap to re-authenticate'

function formatSyncError(err: unknown, fallback: string): string {
  if (isSessionExpiredError(err)) return SESSION_EXPIRED_MESSAGE
  if (isKratosApiError(err)) return `${fallback} (${err.status})`
  if (err instanceof Error && err.message) return err.message
  return fallback
}

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
  exercises: Exercise[],
  onError: (err: unknown) => void
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
  } catch (err) {
    onError(err)
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
      const expired = isSessionExpiredError(err)
      if (expired) setSessionExpired(true)
      const cachedCount = await db.routines.count().catch(() => 0)
      if (expired || cachedCount === 0) {
        setStatus({
          kind: 'error',
          message: formatSyncError(err, 'Failed to fetch routines'),
        })
      }
      void reportClientError(err, { source: 'routines_fetch' })
    }
  }, [setSessionExpired, setStatus])

  return { exercises, routines, loadCatalogue, loadRoutines }
}

function useRecommendationSynthesizers(
  circadianDate: string,
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void,
  setIsGeneratingWorkout: (val: boolean) => void,
  setWorkoutRecommendation: (val: WorkoutRecommendation | null) => void
) {
  const synthesizeWorkoutRecommendation = useCallback(
    async (customContext?: string) => {
      setIsGeneratingWorkout(true)
      try {
        const updated = await api.synthesizeWorkoutRecommendation(customContext, circadianDate)
        setWorkoutRecommendation(updated)
      } catch (err) {
        if (isSessionExpiredError(err)) setSessionExpired(true)
        setStatus({
          kind: 'error',
          message: formatSyncError(err, 'Failed to synthesize workout recommendation'),
        })
        void reportClientError(err, { source: 'workout_synthesis' })
        throw err
      } finally {
        setIsGeneratingWorkout(false)
      }
    },
    [circadianDate, setSessionExpired, setStatus, setIsGeneratingWorkout, setWorkoutRecommendation]
  )

  return { synthesizeWorkoutRecommendation }
}

function applyBiometricsResults(
  results: [
    PromiseSettledResult<DailyBiometrics | null>,
    PromiseSettledResult<WorkoutRecommendation | null>,
  ],
  handlers: {
    setBiometrics: (val: DailyBiometrics | null) => void
    setWorkoutRecommendation: (val: WorkoutRecommendation | null) => void
    setSessionExpired: (val: boolean) => void
    setStatus: (status: SyncStatus) => void
  }
): void {
  const [bioRes, workoutRes] = results
  if (workoutRes.status === 'fulfilled' && workoutRes.value) {
    handlers.setWorkoutRecommendation(workoutRes.value)
  }
  if (bioRes.status === 'fulfilled' && bioRes.value) {
    handlers.setBiometrics(bioRes.value)
  }
  const firstFailure = results.find((res): res is PromiseRejectedResult => res.status === 'rejected')
  if (firstFailure) {
    const err = firstFailure.reason
    if (isSessionExpiredError(err)) handlers.setSessionExpired(true)
    handlers.setStatus({ kind: 'error', message: formatSyncError(err, 'Failed to load biometrics') })
    void reportClientError(err, { source: 'biometrics_fetch' })
    return
  }
  handlers.setSessionExpired(false)
}

function useBiometricsState(
  circadianDate: string,
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
) {
  const [biometrics, setBiometrics] = useState<DailyBiometrics | null>(null)
  const [workoutRecommendation, setWorkoutRecommendation] = useState<WorkoutRecommendation | null>(null)
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState<boolean>(false)

  const loadBiometrics = useCallback(async () => {
    setIsGeneratingWorkout(true)
    try {
      const results = await Promise.allSettled([
        api.getBiometricsToday(),
        api.getWorkoutRecommendation().finally(() => setIsGeneratingWorkout(false)),
      ])
      applyBiometricsResults(results, {
        setBiometrics,
        setWorkoutRecommendation,
        setSessionExpired,
        setStatus,
      })
    } finally {
      setIsGeneratingWorkout(false)
    }
  }, [setSessionExpired, setStatus])

  const synths = useRecommendationSynthesizers(
    circadianDate,
    setSessionExpired,
    setStatus,
    setIsGeneratingWorkout,
    setWorkoutRecommendation
  )

  return {
    biometrics,
    workoutRecommendation,
    isGeneratingWorkout,
    loadBiometrics,
    ...synths,
  }
}

async function deleteSessionRemoteOrMissing(
  sessionId: string,
  isInferred: boolean,
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
): Promise<boolean> {
  try {
    await api.deleteSession(sessionId, isInferred)
    return true
  } catch (err) {
    if (isKratosApiError(err) && err.status === 404) return true
    if (isSessionExpiredError(err)) setSessionExpired(true)
    setStatus({ kind: 'error', message: formatSyncError(err, 'Failed to delete session') })
    void reportClientError(err, { source: 'session_delete', sessionId })
    return false
  }
}

function useSessionWriteMutations(
  sessions: SessionPayload[],
  setSessions: React.Dispatch<React.SetStateAction<SessionPayload[]>>,
  routines: Routine[],
  exercises: Exercise[],
  sync: () => Promise<void>,
  loadSessions: () => Promise<void>,
  refreshQueueCount: () => Promise<void>,
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
) {
  const persistSession = useCallback(
    async (
      finalSession: SessionPayload,
      feedback?: { effort: EffortRating; tags: string[]; notes: string }
    ) => {
      await enqueue(finalSession)
      await sync()
      await loadSessions()
      if (!feedback) return
      await sendWorkoutFeedbackBestEffort(finalSession, feedback, routines, exercises, (err) => {
        if (isSessionExpiredError(err)) setSessionExpired(true)
        setStatus({ kind: 'error', message: formatSyncError(err, 'Failed to sync workout feedback') })
        void reportClientError(err, { source: 'workout_feedback_save' })
      })
    },
    [routines, exercises, sync, loadSessions, setSessionExpired, setStatus]
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const target = sessions.find((s) => s.id === sessionId)
      const removed = await deleteSessionRemoteOrMissing(
        sessionId,
        Boolean(target?.extra?.inferred),
        setSessionExpired,
        setStatus
      )
      if (!removed) return
      await db.outbox.delete(sessionId).catch(() => undefined)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      await refreshQueueCount()
    },
    [sessions, setSessions, refreshQueueCount, setSessionExpired, setStatus]
  )

  return { persistSession, deleteSession }
}

function useSessionRecordMutations(
  sessions: SessionPayload[],
  setSessions: React.Dispatch<React.SetStateAction<SessionPayload[]>>,
  sync: () => Promise<void>,
  loadSessions: () => Promise<void>,
  refreshQueueCount: () => Promise<void>
) {
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

  return { confirmSession, updateSessionRecord, splitSessionRecord }
}

function useSessionMutations(
  sessions: SessionPayload[],
  setSessions: React.Dispatch<React.SetStateAction<SessionPayload[]>>,
  routines: Routine[],
  exercises: Exercise[],
  sync: () => Promise<void>,
  loadSessions: () => Promise<void>,
  refreshQueueCount: () => Promise<void>,
  setSessionExpired: (val: boolean) => void,
  setStatus: (status: SyncStatus) => void
) {
  const writes = useSessionWriteMutations(
    sessions,
    setSessions,
    routines,
    exercises,
    sync,
    loadSessions,
    refreshQueueCount,
    setSessionExpired,
    setStatus
  )
  const records = useSessionRecordMutations(sessions, setSessions, sync, loadSessions, refreshQueueCount)
  return { ...writes, ...records }
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
      if (isSessionExpiredError(err)) setSessionExpired(true)
      setStatus({
        kind: 'error',
        message: formatSyncError(err, 'Failed to load sessions'),
      })
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
    refreshQueueCount,
    setSessionExpired,
    setStatus
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
    ])
  }, [
    refreshCircadianClock,
    sessionsState.sync,
    sessionsState.loadSessions,
    biometricsState.loadBiometrics,
    catalogue.loadCatalogue,
    catalogue.loadRoutines,
  ])

  useRefreshLifecycle(refreshAll, refreshCircadianClock)

  return {
    status,
    sessionExpired,
    queued: sessionsState.queued,
    exercises: catalogue.exercises,
    routines: catalogue.routines,
    sessions: sessionsState.sessions,
    biometrics: biometricsState.biometrics,
    workoutRecommendation: biometricsState.workoutRecommendation,
    isGeneratingWorkout: biometricsState.isGeneratingWorkout,
    circadianDate,
    dayOfWeek,
    sync: sessionsState.sync,
    refreshAll,
    persistSession: sessionsState.persistSession,
    deleteSession: sessionsState.deleteSession,
    confirmSession: sessionsState.confirmSession,
    updateSessionRecord: sessionsState.updateSessionRecord,
    splitSessionRecord: sessionsState.splitSessionRecord,
    synthesizeWorkoutRecommendation: biometricsState.synthesizeWorkoutRecommendation,
  }
}
