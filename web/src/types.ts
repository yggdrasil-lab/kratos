// Shapes mirroring the FastAPI service's OpenAPI schema. Regenerate rather than
// hand-editing once the API settles; for now this is the hand-written seed.

export type Tracking =
  | 'reps_weight'
  | 'reps_only'
  | 'duration'
  | 'completion'
  | 'distance_duration'

export type SetStatus = 'done' | 'missed' | 'skipped'

export type WeightBasis = 'total' | 'per_hand'

export interface Exercise {
  id: string
  name: string
  tracking: Tracking
  equipment: string | null
  mechanics: string | null
  weight_basis: WeightBasis
  primary_muscles: string[]
  secondary_muscles: string[]
  progression_scheme: string | null
  video_url: string | null
  notes: string | null
  extra: Record<string, unknown>
}

export interface Routine {
  id: string
  name: string
  notes: string | null
  extra: Record<string, unknown>
}

export interface SetEntry {
  id: string
  set_number: number
  status: SetStatus
  reps: number | null
  weight_kg: string | null
  duration_s: number | null
  distance_m: number | null
  rpe: string | null
  notes: string | null
  extra: Record<string, unknown>
}

export interface SessionPayload {
  id: string
  routine_id: string | null
  started_at: string
  ended_at: string | null
  notes: string | null
  extra: Record<string, unknown>
  items: SessionItemPayload[]
}

export interface SessionItemPayload {
  id: string
  exercise_id: string
  position: number
  notes: string | null
  extra: Record<string, unknown>
  sets: SetEntry[]
}
