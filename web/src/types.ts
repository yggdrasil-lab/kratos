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

export interface RoutineItem {
  id: string
  routine_id: string
  exercise_id: string
  position: number
  target_sets: number | null
  target_reps: number | null
  target_weight_kg: number | null
  target_duration_s: number | null
  notes: string | null
}

export interface Routine {
  id: string
  name: string
  notes: string | null
  extra: Record<string, unknown>
  items: RoutineItem[]
}

export interface SetEntry {
  id: string
  set_number: number
  status: SetStatus
  reps: number | null
  weight_kg: number | null
  duration_s: number | null
  distance_m: number | null
  rpe: number | null
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
  deleted_at?: string | null
  items: SessionItemPayload[]
}

export type ActivityType = 'gym' | 'class' | 'walk' | 'badminton' | 'swim'

export interface WorkoutMetrics {
  started_at: string
  ended_at: string
  duration_minutes: number
  active_energy_kcal?: number | null
  avg_hr_bpm?: number | null
  peak_hr_bpm?: number | null
  step_count?: number | null
  confidence?: string | null
  activity_type?: string | null
  classification?: string | null
  routine_name?: string | null
  effort_rating?: EffortRating | string | null
  rpe?: number | null
  trimp?: number | null
  hr_zones?: Record<string, number> | null
  hr_recovery_60s?: number | null
}

export interface WorkoutTimelineBin {
  started_at: string
  ended_at: string
  avg_hr_bpm?: number | null
  peak_hr_bpm?: number | null
  hr_sample_count: number
  step_count: number
  active_energy_kcal: number
  is_active_watch_mode: boolean
}

export interface SuggestedSplitPoint {
  split_at: string
  resume_at: string
  reason: string
  confidence: string
}

export interface WorkoutTimelineResponse {
  started_at?: string | null
  ended_at?: string | null
  bins: WorkoutTimelineBin[]
  suggested_splits: SuggestedSplitPoint[]
}

export interface SplitSegmentInput {
  started_at: string
  ended_at: string
  routine_id: string | null
  routine_name: string | null
  activity_type: string | null
  classification: string | null
  effort_rating: EffortRating | null
  notes: string | null
}

export interface SessionSplitResponse {
  parent_id: string
  sessions: SessionPayload[]
}

export interface SessionItemPayload {
  id: string
  exercise_id: string
  position: number
  notes: string | null
  extra: Record<string, unknown>
  sets: SetEntry[]
}

export type ActiveTab = 'today' | 'progress' | 'train' | 'week' | 'history'

export type EffortRating = 'too_easy' | 'optimal' | 'hard' | 'too_hard'

export interface FastingCheckIn {
  id: string
  date: string
  target_window: string
  adherence: 'completed' | 'early' | 'off_plan'
  energy?: 'high' | 'normal' | 'low'
  headache?: 'none' | 'mild' | 'sugar_spike'
  notes?: string | null
  logged_at: string
}

export interface FastingRecommendation {
  date: string
  protocol_name: string
  target_window: string
  window_hours: string
  rationale: string
  fueling_anchors: string[]
  recovery_status: 'optimal' | 'moderate' | 'fatigued'
  activity_context: string
  is_llm_generated?: boolean
  research_citation?: string | null
}

export interface RecommendedExerciseItem {
  exercise_name: string
  target_sets: number
  target_reps: string
  suggested_weight_kg?: number | null
  weight_basis: WeightBasis
  notes?: string | null
}

export interface WorkoutRecommendation {
  date: string
  routine_name: string
  readiness_adaptation: string
  target_rir: string
  volume_landmark: string
  rationale: string
  exercises: RecommendedExerciseItem[]
  recovery_status: 'optimal' | 'moderate' | 'fatigued'
  research_citation?: string | null
  is_llm_generated?: boolean
}

export interface HealthFeedback {
  id?: string
  date: string
  feedback_type: string
  rating?: string | null
  score?: number | null
  tags?: string[]
  payload?: Record<string, unknown>
  notes?: string | null
  logged_at?: string
}

export type ReadinessTier = 'optimal' | 'moderate' | 'fatigued'

export interface BackendReadiness {
  tier: ReadinessTier
  label: string
  message: string
}

export interface DailyBiometrics {
  date: string
  latest_weight_kg?: number | string | null
  latest_body_fat_pct?: number | string | null
  resting_hr_bpm?: number | null
  hrv_ms?: number | string | null
  sleep_duration_hours?: number | null
  sleep_deep_hours?: number | null
  sleep_score?: number | null
  step_count?: number | null
  active_energy_kcal?: number | null
  readiness?: BackendReadiness | null
  readiness_notes?: string[]
  fasting?: HealthFeedback | null
  workout?: HealthFeedback | null
  wellness?: HealthFeedback | null
}

export interface PlannedActivity {
  id: string
  name: string
  type: 'lift' | 'sport' | 'rest' | 'none'
  emphasis?: string
  notes?: string
  durationMinutes?: number
  isUnplanned?: boolean
}

export interface DayScheduleConfig {
  dayIndex?: number
  sessionName: string
  type: 'lift' | 'sport' | 'rest' | 'none'
  emphasis: string
  notes?: string
  extraActivities?: PlannedActivity[]
}

export interface WeekDayPlan {
  dayIndex: number
  dayName: string
  dayShort: string
  dateStr: string
  isoDate: string
  isToday: boolean
  sessionName: string
  type: 'lift' | 'sport' | 'rest' | 'none'
  emphasis: string
  notes?: string
  extraActivities?: PlannedActivity[]
}

export interface WeeklyPlanRead {
  id: string
  iso_week: string
  days: DayScheduleConfig[]
  notes: string | null
  extra: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface WeeklyPlanPayload {
  iso_week: string
  days: DayScheduleConfig[]
  notes?: string | null
  extra?: Record<string, unknown>
}

export interface ClientErrorPayload {
  message: string
  source?: string
  lineno?: number
  colno?: number
  error_type?: string
  stack?: string
  url?: string
  user_agent?: string
  timestamp?: string
  extra?: Record<string, unknown>
}


