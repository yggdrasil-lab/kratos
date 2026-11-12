import type { Page } from '@playwright/test'

export const MOCK_EXERCISES = [
  {
    id: 'ex-bench-press',
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
    id: 'ex-squat',
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
    id: 'ex-overhead-press',
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
    id: 'routine-upper-a',
    name: 'Upper Body A',
    notes: 'Primary heavy upper day',
    extra: {},
    items: [
      {
        id: 'ri-1',
        routine_id: 'routine-upper-a',
        exercise_id: 'ex-bench-press',
        position: 0,
        target_sets: 3,
        target_reps: 8,
        target_weight_kg: 30,
        target_duration_s: null,
        notes: null,
      },
      {
        id: 'ri-2',
        routine_id: 'routine-upper-a',
        exercise_id: 'ex-overhead-press',
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
    id: 'routine-lower-a',
    name: 'Lower Body A',
    notes: 'Squat and hinge focus',
    extra: {},
    items: [
      {
        id: 'ri-lower-1',
        routine_id: 'routine-lower-a',
        exercise_id: 'ex-squat',
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
    id: 'routine-badminton',
    name: '🏸 Badminton Match Play',
    notes: 'Court play session',
    extra: {},
    items: [],
  },
]

export const MOCK_SESSIONS = [
  {
    id: 'sess-history-1',
    routine_id: 'routine-upper-a',
    started_at: '2026-11-01T10:00:00.000Z',
    ended_at: '2026-11-01T11:00:00.000Z',
    notes: 'Solid session',
    extra: { routine_name: 'Upper Body A', effort_rating: 'optimal', effort_tags: ['Felt Strong'] },
    items: [
      {
        id: 'si-1',
        exercise_id: 'ex-bench-press',
        position: 0,
        notes: null,
        extra: {},
        sets: [
          {
            id: 'set-1',
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
    id: 'sess-badminton-1',
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

export interface MockApiState {
  exercises: typeof MOCK_EXERCISES
  routines: typeof MOCK_ROUTINES
  sessions: typeof MOCK_SESSIONS
  savedSessions: unknown[]
  deletedSessionIds: string[]
  savedFastingCheckIns: unknown[]
  clientErrors: unknown[]
}

export async function setupMockApi(page: Page): Promise<MockApiState> {
  // Pin browser date/clock to a scheduled lifting day (Monday) so tests are calendar-invariant
  await page.clock.setFixedTime('2026-11-02T10:00:00Z')

  const state: MockApiState = {
    exercises: [...MOCK_EXERCISES],
    routines: [...MOCK_ROUTINES],
    sessions: [...MOCK_SESSIONS],
    savedSessions: [],
    deletedSessionIds: [],
    savedFastingCheckIns: [],
    clientErrors: [],
  }

  await page.route('**/api/client-errors**', async (route) => {
    if (route.request().method() === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.clientErrors.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
      return
    }
    await route.continue()
  })

  await page.route('**/api/exercises**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.exercises),
    })
  })

  await page.route('**/api/routines**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.routines),
    })
  })

  await page.route('**/api/sessions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.sessions),
      })
      return
    }
    await route.continue()
  })

  await page.route('**/api/sessions/*', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = request.url()
    const id = url.split('/').pop() || ''

    if (method === 'PUT') {
      const payload = JSON.parse(request.postData() || '{}')
      state.savedSessions.push(payload)
      const existingIdx = state.sessions.findIndex((s) => s.id === id)
      if (existingIdx >= 0) {
        state.sessions[existingIdx] = payload
      } else {
        state.sessions.unshift(payload)
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
      return
    }

    if (method === 'DELETE') {
      state.deletedSessionIds.push(id)
      state.sessions = state.sessions.filter((s) => s.id !== id)
      await route.fulfill({
        status: 204,
        body: '',
      })
      return
    }

    await route.continue()
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
        hrv_ms: 50.26,
        sleep_duration_hours: 8.11,
        sleep_deep_hours: 1.25,
        step_count: 966,
        active_energy_kcal: 40,
        readiness_notes: ['Apple Health rollup for 2026-11-01'],
      }),
    })
  })

  await page.route(/\/api\/biometrics\/fasting-recommendation\/synthesize(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: '2026-11-01',
          protocol_name: '14:10 Shifted Schedule Protocol',
          target_window: '14:10',
          window_hours: '11:00 AM - 9:00 PM',
          rationale: 'Custom user schedule adjustment incorporated with 3h pre-bed cutoff.',
          fueling_anchors: [
            '11:00 AM: Meal 1 with 40g protein',
            '04:00 PM: Pre-workout fuel',
            '08:30 PM: Recovery meal',
          ],
          recovery_status: 'optimal',
          activity_context: 'Badminton Match Play (sport)',
          is_llm_generated: true,
          research_citation: 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)',
        }),
      })
      return
    }
    await route.continue()
  })

  await page.route(/\/api\/biometrics\/fasting-recommendation(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: '2026-11-01',
        protocol_name: '14:10 Badminton Court Fueling',
        target_window: '14:10',
        window_hours: '10:30 AM - 8:30 PM',
        rationale: 'Court session scheduled. Standard 14:10 window with a zero-prep pre-court top-up and post-court protein recovery.',
        fueling_anchors: [
          'Morning: Clean fast with water, black coffee, or tea until 10:30 AM',
          '10:30 AM: Leftovers or eat-out plate triage, protein first, then carbs and sides to satiety',
          '05:00 PM: Pre-court top-up, whey protein shake in water or milk (optional)',
          'Post-court or family dinner: plate triage, protein first, then carbs and sides to satiety',
        ],
        recovery_status: 'optimal',
        activity_context: 'Badminton Match Play (sport)',
        is_llm_generated: true,
        research_citation: 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)',
      }),
    })
  })

  await page.route(/\/api\/biometrics\/workout-recommendation\/synthesize(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      })
      return
    }
    await route.continue()
  })

  await page.route(/\/api\/biometrics\/workout-recommendation(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    })
  })

  await page.route(/\/api\/biometrics\/fasting(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.savedFastingCheckIns.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
      return
    }
    await route.continue()
  })

  await page.route('**/api/biometrics/workout-feedback**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
      return
    }
    await route.continue()
  })

  await page.route('**/api/plans/week/**', async (route) => {
    await route.fulfill({
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
  })

  return state
}
