// Typed fetch wrapper. Paths are same-origin by default: the Vite dev server
// proxies /api to uvicorn, and in production the reverse proxy routes it too.
// VITE_API_BASE_URL overrides the prefix for a split deployment.

import { authFetch, SessionExpiredError } from '@yggdrasil-lab/ui'
import type { ClientErrorPayload, DailyBiometrics, Exercise, FastingCheckIn, FastingRecommendation, Routine, SessionPayload, WeeklyPlanPayload, WeeklyPlanRead } from './types'

export { SessionExpiredError }

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${detail}`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
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

  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, {
      method: 'DELETE',
    }),

  getWeeklyPlan: async (isoWeek: string): Promise<WeeklyPlanRead | null> => {
    try {
      return await request<WeeklyPlanRead>(`/plans/week/${isoWeek}`)
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err
      }
      return null
    }
  },

  putWeeklyPlan: (payload: WeeklyPlanPayload) =>
    request<WeeklyPlanRead>(`/plans/week/${payload.iso_week}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getBiometricsToday: async (): Promise<DailyBiometrics | null> => {
    try {
      return await request<DailyBiometrics>('/biometrics/today')
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err
      }
      return null
    }
  },

  getFastingRecommendation: async (targetDate?: string): Promise<FastingRecommendation | null> => {
    try {
      const suffix = targetDate ? `?target_date=${encodeURIComponent(targetDate)}` : ''
      return await request<FastingRecommendation>(`/biometrics/fasting-recommendation${suffix}`)
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err
      }
      return null
    }
  },

  synthesizeFastingRecommendation: async (
    customContext?: string,
    targetDate?: string,
  ): Promise<FastingRecommendation | null> => {
    try {
      return await request<FastingRecommendation>('/biometrics/fasting-recommendation/synthesize', {
        method: 'POST',
        body: JSON.stringify({
          target_date: targetDate,
          custom_context: customContext,
        }),
      })
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err
      }
      return null
    }
  },

  saveFastingCheckIn: async (payload: FastingCheckIn): Promise<void> => {
    try {
      await request<void>('/biometrics/fasting', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err
      }
      // Offline fallback: saved to IndexedDB
    }
  },

  saveWorkoutFeedback: async (payload: {
    date: string
    routine_name?: string
    duration_minutes?: number
    total_volume_kg?: number
    completed_sets?: number
    effort_rating: string
    tags?: string[]
    notes?: string
    logged_at?: string
  }): Promise<void> => {
    try {
      await request<void>('/biometrics/workout-feedback', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err
      }
      // Offline fallback
    }
  },

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
