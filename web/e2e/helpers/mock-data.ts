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
]

export const MOCK_SESSIONS = [
  {
    id: 'sess-history-1',
    routine_id: 'routine-upper-a',
    started_at: '2026-10-25T08:00:00.000Z',
    ended_at: '2026-10-25T08:45:00.000Z',
    notes: 'Solid session',
    extra: { routine_name: 'Upper Body A' },
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
]

export interface MockApiState {
  exercises: typeof MOCK_EXERCISES
  routines: typeof MOCK_ROUTINES
  sessions: typeof MOCK_SESSIONS
  savedSessions: unknown[]
  deletedSessionIds: string[]
}

export async function setupMockApi(page: Page): Promise<MockApiState> {
  const state: MockApiState = {
    exercises: [...MOCK_EXERCISES],
    routines: [...MOCK_ROUTINES],
    sessions: [...MOCK_SESSIONS],
    savedSessions: [],
    deletedSessionIds: [],
  }

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
