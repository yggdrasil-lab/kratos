// Typed fetch wrapper. Paths are same-origin by default: the Vite dev server
// proxies /api to uvicorn, and in production the reverse proxy routes it too.
// VITE_API_BASE_URL overrides the prefix for a split deployment.

import type { Exercise, Routine, SessionPayload } from './types'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
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

  // The outbox sends the whole session under a client-generated UUID; the write
  // path upserts on it, so a retried flush is harmless.
  putSession: (payload: SessionPayload) =>
    request<SessionPayload>(`/sessions/${payload.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
}
