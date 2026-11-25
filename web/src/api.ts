// Typed fetch wrapper. Paths are same-origin by default: the Vite dev server
// proxies /api to uvicorn, and in production the reverse proxy routes it too.
// VITE_API_BASE_URL overrides the prefix for a split deployment.

import { authFetch, SessionExpiredError } from '@yggdrasil-lab/ui'
import type {
  ClientErrorPayload,
  DailyBiometrics,
  Exercise,
  FastingCheckIn,
  FastingRecommendation,
  Routine,
  SessionPayload,
  SessionSplitResponse,
  SplitSegmentInput,
  WeeklyPlanPayload,
  WeeklyPlanRead,
  WorkoutMetrics,
  WorkoutRecommendation,
  WorkoutTimelineResponse,
} from './types'

export { SessionExpiredError }

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export interface KratosApiErrorOptions {
  status: number
  statusText: string
  detail: string
  path: string
}

/**
 * Typed HTTP error thrown when a Kratos API request returns a non-OK response.
 */
export class KratosApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly detail: string
  readonly path: string

  constructor(options: KratosApiErrorOptions) {
    super(`${options.status} ${options.statusText}: ${options.detail}`)
    this.name = 'KratosApiError'
    this.status = options.status
    this.statusText = options.statusText
    this.detail = options.detail
    this.path = options.path
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isKratosApiError(err: unknown): err is KratosApiError {
  return err instanceof KratosApiError || (err instanceof Error && err.name === 'KratosApiError')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new KratosApiError({
      status: response.status,
      statusText: response.statusText,
      detail,
      path,
    })
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function requestOrNull<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    return await request<T>(path, init)
  } catch (err) {
    if (isKratosApiError(err) && err.status === 404) {
      return null
    }
    throw err
  }
}

export const api = {
  exercises: (params: { muscle?: string; tracking?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.muscle) query.set('muscle', params.muscle)
    if (params.tracking) query.set('tracking', params.tracking)
    const suffix = query.toString() ? `?${query}` : ''
    return request<Exercise[]>(`/exercises${suffix}`)
  },

  routines: () => request<Routine[]>('/routines'),

  sessions: (limit = 50, offset = 0) =>
    request<SessionPayload[]>(`/sessions?limit=${limit}&offset=${offset}`),

  getSession: (id: string) => request<SessionPayload>(`/sessions/${id}`),

  // The outbox sends the whole session under a client-generated UUID; the write
  // path upserts on it, so a retried flush is harmless.
  putSession: (payload: SessionPayload) =>
    request<SessionPayload>(`/sessions/${payload.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteSession: (id: string, dismissed = false) =>
    request<void>(`/sessions/${id}${dismissed ? '?dismissed=true' : ''}`, {
      method: 'DELETE',
    }),

  splitSession: (id: string, segments: SplitSegmentInput[]) =>
    request<SessionSplitResponse>(`/sessions/${id}/split`, {
      method: 'POST',
      body: JSON.stringify({ segments }),
    }),

  getWorkoutMetrics: (
    params: {
      started_at: string
      ended_at: string
      classification?: string | null
      activity_type?: string | null
      routine_name?: string | null
    },
    signal?: AbortSignal
  ) => {
    const query = new URLSearchParams({
      started_at: params.started_at,
      ended_at: params.ended_at,
    })
    if (params.classification) query.set('classification', params.classification)
    if (params.activity_type) query.set('activity_type', params.activity_type)
    if (params.routine_name) query.set('routine_name', params.routine_name)
    return request<WorkoutMetrics>(`/biometrics/workout-metrics?${query}`, { signal })
  },

  getWorkoutTimeline: (startedAt: string, endedAt: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({
      started_at: startedAt,
      ended_at: endedAt,
    })
    return request<WorkoutTimelineResponse>(`/biometrics/workout-timeline?${query}`, { signal })
  },

  getWeeklyPlan: (isoWeek: string): Promise<WeeklyPlanRead | null> =>
    requestOrNull<WeeklyPlanRead>(`/plans/week/${isoWeek}`),

  putWeeklyPlan: (payload: WeeklyPlanPayload) =>
    request<WeeklyPlanRead>(`/plans/week/${payload.iso_week}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getBiometricsToday: (): Promise<DailyBiometrics | null> =>
    requestOrNull<DailyBiometrics>('/biometrics/today'),

  getFastingRecommendation: (targetDate?: string): Promise<FastingRecommendation | null> => {
    const suffix = targetDate ? `?target_date=${encodeURIComponent(targetDate)}` : ''
    return requestOrNull<FastingRecommendation>(`/biometrics/fasting-recommendation${suffix}`)
  },

  synthesizeFastingRecommendation: (
    customContext?: string,
    targetDate?: string
  ): Promise<FastingRecommendation> =>
    request<FastingRecommendation>('/biometrics/fasting-recommendation/synthesize', {
      method: 'POST',
      body: JSON.stringify({
        target_date: targetDate,
        custom_context: customContext,
      }),
    }),

  getWorkoutRecommendation: (targetDate?: string): Promise<WorkoutRecommendation | null> => {
    const suffix = targetDate ? `?target_date=${encodeURIComponent(targetDate)}` : ''
    return requestOrNull<WorkoutRecommendation>(`/biometrics/workout-recommendation${suffix}`)
  },

  synthesizeWorkoutRecommendation: (
    customContext?: string,
    targetDate?: string
  ): Promise<WorkoutRecommendation> =>
    request<WorkoutRecommendation>('/biometrics/workout-recommendation/synthesize', {
      method: 'POST',
      body: JSON.stringify({
        target_date: targetDate,
        custom_context: customContext,
      }),
    }),

  saveFastingCheckIn: (payload: FastingCheckIn): Promise<void> =>
    request<void>('/biometrics/fasting', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveWorkoutFeedback: (payload: {
    date: string
    routine_name?: string
    duration_minutes?: number
    total_volume_kg?: number
    completed_sets?: number
    effort_rating: string
    tags?: string[]
    notes?: string
    logged_at?: string
  }): Promise<void> =>
    request<void>('/biometrics/workout-feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reportClientError: async (payload: ClientErrorPayload): Promise<void> => {
    try {
      await request<void>('/client-errors', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch {
      // Best-effort error reporting
    }
  },
}
