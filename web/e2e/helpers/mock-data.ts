import type { Page } from '@playwright/test'

export const MOCK_EXERCISES = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'Bench Press (Dumbbell)',
    tracking: 'reps_weight',
    equipment: 'Dumbbell',
    mechanics: 'compound',
    weight_basis: 'per_hand',
    primary_muscles: ['Chest'],
    secondary_muscles: ['Triceps', 'Front Shoulders'],
    progression_scheme: null,
    video_url: null,
    notes: 'Keep elbows at 45 degrees',
    extra: {},
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'Barbell Squat',
    tracking: 'reps_weight',
    equipment: 'Barbell',
    mechanics: 'compound',
    weight_basis: 'total',
    primary_muscles: ['Quads'],
    secondary_muscles: ['Glutes', 'Hamstrings'],
    progression_scheme: null,
    video_url: null,
    notes: 'Depth below parallel',
    extra: {},
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Overhead Press',
    tracking: 'reps_weight',
    equipment: 'Barbell',
    mechanics: 'compound',
    weight_basis: 'total',
    primary_muscles: ['Shoulders'],
    secondary_muscles: ['Triceps'],
    progression_scheme: null,
    video_url: null,
    notes: 'Strict press from collarbone',
    extra: {},
  },
]

export const MOCK_ROUTINES = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    name: 'Upper Body A',
    notes: 'Primary heavy upper day',
    extra: {},
    items: [
      {
        id: '00000000-0000-4000-8000-000000000301',
        routine_id: '00000000-0000-4000-8000-000000000201',
        exercise_id: '00000000-0000-4000-8000-000000000101',
        position: 0,
        target_sets: 3,
        target_reps: 8,
        target_weight_kg: 30,
        target_duration_s: null,
        notes: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000302',
        routine_id: '00000000-0000-4000-8000-000000000201',
        exercise_id: '00000000-0000-4000-8000-000000000103',
        position: 1,
        target_sets: 3,
        target_reps: 10,
        target_weight_kg: 40,
        target_duration_s: null,
        notes: null,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    name: 'Lower Body A',
    notes: 'Squat and hinge focus',
    extra: {},
    items: [
      {
        id: '00000000-0000-4000-8000-000000000303',
        routine_id: '00000000-0000-4000-8000-000000000202',
        exercise_id: '00000000-0000-4000-8000-000000000102',
        position: 0,
        target_sets: 3,
        target_reps: 8,
        target_weight_kg: 80,
        target_duration_s: null,
        notes: null,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000203',
    name: '🏸 Badminton Match Play',
    notes: 'Court play session',
    extra: {},
    items: [],
  },
]

export const MOCK_SESSIONS = [
  {
    id: '00000000-0000-4000-8000-000000000401',
    routine_id: '00000000-0000-4000-8000-000000000201',
    started_at: '2026-11-01T10:00:00.000Z',
    ended_at: '2026-11-01T11:00:00.000Z',
    notes: 'Solid session',
    extra: { routine_name: 'Upper Body A', effort_rating: 'optimal', effort_tags: ['Felt Strong'] },
    items: [
      {
        id: '00000000-0000-4000-8000-000000000501',
        exercise_id: '00000000-0000-4000-8000-000000000101',
        position: 0,
        notes: null,
        extra: {},
        sets: [
          {
            id: '00000000-0000-4000-8000-000000000601',
            set_number: 1,
            status: 'done',
            reps: 8,
            weight_kg: 30,
            duration_s: null,
            distance_m: null,
            rpe: 8,
            notes: null,
            extra: {},
          },
        ],
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000402',
    routine_id: null,
    started_at: '2026-11-02T19:00:00.000Z',
    ended_at: '2026-11-02T20:05:00.000Z',
    notes: 'Auto-detected Badminton Match Play from Apple Health biometrics',
    extra: {
      routine_name: 'Badminton Match Play',
      classification: 'badminton',
      activity_type: 'badminton',
      inferred: true,
      duration_minutes: 65,
      active_energy_kcal: 91,
      avg_hr: 157,
      peak_hr: 176,
      step_count: 2267,
      effort_rating: 'hard',
      rpe: 8.7,
      trimp: 257.1,
      hr_recovery_60s: 25,
      hr_zones: {
        z1_recovery_pct: 4.3,
        z2_aerobic_pct: 14.9,
        z3_tempo_pct: 6.4,
        z4_threshold_pct: 29.8,
        z5_anaerobic_pct: 44.7,
        z1_mins: 2.8,
        z2_mins: 9.7,
        z3_mins: 4.1,
        z4_mins: 19.4,
        z5_mins: 29.0,
      },
    },
    items: [],
  },
]

export interface MockSessionRecord {
  id: string
  routine_id: string | null
  started_at: string
  ended_at: string | null
  notes: string | null
  extra: Record<string, unknown>
  items: unknown[]
}

export interface MockApiState {
  exercises: typeof MOCK_EXERCISES
  routines: typeof MOCK_ROUTINES
  sessions: MockSessionRecord[]
  savedSessions: MockSessionRecord[]
  deletedSessionIds: string[]
  deleteDismissedIds: string[]
  splitRequests: { parentId: string; segments: Record<string, unknown>[] }[]
  metricsQueries: string[]
  timelineQueries: string[]
  clientErrors: unknown[]
}

function buildMockTimeline(startedAtIso: string, endedAtIso: string) {
  const startMs = new Date(startedAtIso).getTime()
  const endMs = new Date(endedAtIso).getTime()
  const safeStart = Number.isNaN(startMs) ? Date.parse('2026-11-02T19:00:00.000Z') : startMs
  const safeEnd = Number.isNaN(endMs) || endMs <= safeStart ? safeStart + 60 * 60_000 : endMs

  const bins = []
  const fiveMin = 5 * 60_000
  const midpoint = safeStart + Math.floor((safeEnd - safeStart) / 2 / fiveMin) * fiveMin

  for (let cursor = safeStart, idx = 0; cursor < safeEnd; cursor += fiveMin, idx += 1) {
    const nextCursor = Math.min(safeEnd, cursor + fiveMin)
    const isActiveWatch = cursor >= midpoint
    bins.push({
      started_at: new Date(cursor).toISOString(),
      ended_at: new Date(nextCursor).toISOString(),
      avg_hr_bpm: isActiveWatch ? 138 + (idx % 3) * 4 : 154 + (idx % 3) * 5,
      peak_hr_bpm: isActiveWatch ? 154 : 172,
      hr_sample_count: isActiveWatch ? 24 : 5,
      step_count: isActiveWatch ? 110 : 410,
      active_energy_kcal: isActiveWatch ? 32 : 48,
      is_active_watch_mode: isActiveWatch,
    })
  }

  return {
    started_at: new Date(safeStart).toISOString(),
    ended_at: new Date(safeEnd).toISOString(),
    bins,
    suggested_splits: [
      {
        split_at: new Date(Math.max(safeStart + fiveMin, midpoint - fiveMin)).toISOString(),
        resume_at: new Date(Math.min(safeEnd - fiveMin, midpoint)).toISOString(),
        reason: 'Passive HR to Active Watch transition',
        confidence: 'high',
      },
    ],
  }
}

function buildSplitChildren(
  parentId: string,
  segments: Record<string, unknown>[]
): MockSessionRecord[] {
  return segments.map((seg, idx) => {
    const mins = Math.max(
      1,
      Math.round(
        (new Date(String(seg.ended_at)).getTime() - new Date(String(seg.started_at)).getTime()) /
          60_000
      )
    )
    return {
      id: `00000000-0000-4000-8000-00000000090${idx + 1}`,
      routine_id: (seg.routine_id as string | null) ?? null,
      started_at: String(seg.started_at),
      ended_at: String(seg.ended_at),
      notes: (seg.notes as string | null) ?? null,
      extra: {
        inferred: false,
        confirmed: true,
        telemetry_locked: true,
        manual_split: true,
        split_from_id: parentId,
        routine_name: seg.routine_name || 'Workout',
        activity_type: seg.activity_type || 'gym',
        classification: seg.classification || seg.activity_type || 'gym',
        duration_minutes: mins,
        active_energy_kcal: mins * 7,
        avg_hr: seg.activity_type === 'class' ? 152 : 136,
        peak_hr: seg.activity_type === 'class' ? 171 : 156,
        effort_rating: seg.effort_rating || 'optimal',
        rpe: 7.8,
        trimp: mins * 2.6,
      },
      items: [],
    }
  })
}

async function registerSessionRoutes(page: Page, state: MockApiState): Promise<void> {
  await page.route(/\/api\/sessions(\/|\?|$)/, async (route) => {
    const request = route.request()
    const method = request.method()
    const urlObj = new URL(request.url())
    const pathParts = urlObj.pathname.split('/').filter(Boolean)

    if (method === 'GET' && pathParts.length === 2) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.sessions),
      })
      return
    }

    const id = pathParts[2] || ''
    if (method === 'POST' && pathParts[3] === 'split') {
      const body = JSON.parse(request.postData() || '{}') as { segments?: Record<string, unknown>[] }
      const segments = body.segments || []
      state.splitRequests.push({ parentId: id, segments })
      state.deletedSessionIds.push(id)
      state.deleteDismissedIds.push(id)
      const created = buildSplitChildren(id, segments)
      state.sessions = [...created, ...state.sessions.filter((s) => s.id !== id)]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ parent_id: id, sessions: created }),
      })
      return
    }

    if (method === 'PUT' && id) {
      const payload = JSON.parse(request.postData() || '{}') as MockSessionRecord
      state.savedSessions.push(payload)
      const existingIdx = state.sessions.findIndex((s) => s.id === id)
      if (existingIdx >= 0) state.sessions[existingIdx] = payload
      else state.sessions.unshift(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
      return
    }

    if (method === 'DELETE' && id) {
      state.deletedSessionIds.push(id)
      if (urlObj.searchParams.get('dismissed') === 'true') state.deleteDismissedIds.push(id)
      state.sessions = state.sessions.filter((s) => s.id !== id)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.continue()
  })
}

async function registerBiometricProxyRoutes(page: Page, state: MockApiState): Promise<void> {
  await page.route(/\/api\/biometrics\/workout-timeline(\?|$)/, async (route) => {
    const urlObj = new URL(route.request().url())
    state.timelineQueries.push(urlObj.search)
    const startedAt = urlObj.searchParams.get('started_at') || '2026-11-02T19:00:00.000Z'
    const endedAt = urlObj.searchParams.get('ended_at') || '2026-11-02T20:05:00.000Z'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildMockTimeline(startedAt, endedAt)),
    })
  })

  await page.route(/\/api\/biometrics\/workout-metrics(\?|$)/, async (route) => {
    const urlObj = new URL(route.request().url())
    state.metricsQueries.push(urlObj.search)
    const startedAt = urlObj.searchParams.get('started_at') || '2026-11-02T19:00:00.000Z'
    const endedAt = urlObj.searchParams.get('ended_at') || '2026-11-02T19:30:00.000Z'
    const activityType = urlObj.searchParams.get('activity_type') || 'gym'
    const routineName = urlObj.searchParams.get('routine_name') || 'Workout'
    const mins = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000)
    )
    const emptyWindow = mins <= 10
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        started_at: startedAt,
        ended_at: endedAt,
        duration_minutes: mins,
        active_energy_kcal: emptyWindow ? null : mins * 8,
        avg_hr_bpm: emptyWindow ? null : activityType === 'class' ? 151 : 138,
        peak_hr_bpm: emptyWindow ? null : activityType === 'class' ? 170 : 158,
        step_count: emptyWindow ? null : mins * 35,
        confidence: emptyWindow ? 'none' : 'high',
        activity_type: activityType,
        classification: activityType,
        routine_name: routineName,
        effort_rating: emptyWindow ? null : 'optimal',
        rpe: emptyWindow ? null : 7.9,
        trimp: emptyWindow ? null : Math.round(mins * 2.8),
        hr_zones: null,
        hr_recovery_60s: null,
      }),
    })
  })

  await page.route('**/api/biometrics/today**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: '2026-11-01',
        latest_weight_kg: 86.65,
        latest_body_fat_pct: 25.31,
        resting_hr_bpm: 64,
        hrv_ms: 50.02,
        overnight_hrv_ms: 42.22,
        sleep_duration_hours: 8.11,
        sleep_deep_hours: 1.25,
        nap_duration_hours: 2.51,
        nap_count: 1,
        total_sleep_hours: 9.15,
        naps: [
          {
            start_at: '2026-11-27T11:29:24+13:00',
            end_at: '2026-11-27T14:18:19+13:00',
            duration_hours: 2.51,
          },
        ],
        step_count: 966,
        active_energy_kcal: 40,
        readiness: {
          tier: 'optimal',
          label: 'High Readiness',
          message: 'Optimal state. Prime day to push progressive overload and PRs.',
        },
        readiness_notes: ['Apple Health rollup for 2026-11-01'],
      }),
    })
  })
}

const MOCK_SYNTHESIZED_REC = {
  date: '2026-11-01',
  routine_name: 'Upper Body A (Joint-Sparing Autoregulated)',
  rationale: 'Substituted neutral-grip pressing due to left shoulder friction report.',
  target_rir: 'RPE 7-8 (2 RIR)',
  recovery_status: 'fatigued',
  estimated_duration_min: 35,
  volume_landmark: 'MEV',
  readiness_adaptation: 'Fatigue / Joint Deload',
  exercises: [
    {
      exercise_name: 'Bench Press (Dumbbell)',
      target_sets: 2,
      target_reps: '10-12',
      suggested_weight_kg: 14,
      weight_basis: 'per_hand',
      notes: 'Neutral grip; elbows tucked 45 deg to spare anterior shoulder capsule',
    },
    {
      exercise_name: 'Overhead Press',
      target_sets: 2,
      target_reps: '12-15',
      suggested_weight_kg: 35,
      weight_basis: 'total',
      notes: 'Controlled eccentric 3s cadence; pause at clavicle',
    },
  ],
  is_llm_generated: true,
  research_citation: 'Israetel (Volume Landmarks) & McGill (Joint Sparing)',
}

const MOCK_DEFAULT_REC = {
  date: '2026-11-01',
  routine_name: 'Upper Body A (Chest and Vertical Pull)',
  rationale: 'Recovery score optimal (HRV 50ms, 8.1h sleep). Primed for progressive overload at MAV.',
  target_rir: 'RPE 8-9 (1-2 RIR)',
  recovery_status: 'optimal',
  estimated_duration_min: 45,
  volume_landmark: 'MAV',
  readiness_adaptation: 'Progressive Overload',
  exercises: [
    {
      exercise_name: 'Bench Press (Dumbbell)',
      target_sets: 3,
      target_reps: '8-10',
      suggested_weight_kg: 15,
      weight_basis: 'per_hand',
      notes: 'Progressive overload anchor: push to 1 RIR on set 3',
    },
    {
      exercise_name: 'Overhead Press',
      target_sets: 3,
      target_reps: '10-12',
      suggested_weight_kg: 40,
      weight_basis: 'total',
      notes: 'Strict press from collarbone, solid core brace',
    },
  ],
  is_llm_generated: true,
  research_citation: 'Israetel (Volume Landmarks) & Helms (Autoregulation RIR)',
}

async function registerWorkoutRecRoutes(page: Page): Promise<void> {
  await page.route(/\/api\/biometrics\/workout-recommendation\/synthesize(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SYNTHESIZED_REC) })
  })
  await page.route(/\/api\/biometrics\/workout-recommendation(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_DEFAULT_REC) })
  })
  await page.route('**/api/biometrics/workout-feedback**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
  })
}

async function registerRecommendationRoutes(page: Page): Promise<void> {
  await registerWorkoutRecRoutes(page)
}

export async function setupMockApi(page: Page): Promise<MockApiState> {
  await page.clock.setFixedTime('2026-11-02T10:00:00Z')
  const state: MockApiState = {
    exercises: [...MOCK_EXERCISES],
    routines: [...MOCK_ROUTINES],
    sessions: [...MOCK_SESSIONS],
    savedSessions: [],
    deletedSessionIds: [],
    deleteDismissedIds: [],
    splitRequests: [],
    metricsQueries: [],
    timelineQueries: [],
    clientErrors: [],
  }

  await page.route('**/api/client-errors**', async (route) => {
    if (route.request().method() === 'POST') {
      state.clientErrors.push(JSON.parse(route.request().postData() || '{}'))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
      return
    }
    await route.continue()
  })
  await page.route('**/api/exercises**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.exercises) })
  )
  await page.route('**/api/routines**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.routines) })
  )
  await page.route('**/api/plans/week/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'plan-w43',
        iso_week: '2026-W43',
        days: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })
  )

  await registerSessionRoutes(page, state)
  await registerBiometricProxyRoutes(page, state)
  await registerRecommendationRoutes(page)
  return state
}
