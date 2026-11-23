import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Progress and Activity Stream', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('displays completed sessions in Progress tab', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    await expect(page.getByRole('heading', { name: 'Progress and Momentum' })).toBeVisible()
    await expect(page.getByText('Last 7 Days Workouts')).toBeVisible()

    // Recent session card is visible
    await expect(page.getByText('Upper Body A')).toBeVisible()
    await expect(page.getByText('🟡 Optimal')).toBeVisible()
    await expect(page.getByText('Bench Press (Dumbbell)')).toBeVisible()
  })

  test('collapsible archive displays older sessions and allows deletion', async ({ page }) => {
    const apiState = await setupMockApi(page)
    // Add an older session beyond 7 days
    const olderSess = {
      id: 'sess-older-1',
      routine_id: null,
      started_at: '2026-10-10T08:00:00.000Z',
      ended_at: '2026-10-10T08:45:00.000Z',
      notes: 'Old session',
      extra: { routine_name: 'Old Workout' },
      items: [],
    }
    apiState.sessions.push(olderSess)

    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    // Click to expand Older Sessions Archive
    const expandBtn = page.getByText(/Older Sessions Archive/i)
    await expect(expandBtn).toBeVisible()
    await expandBtn.click()

    // Verify older workout is listed
    await expect(page.getByText('Old Workout')).toBeVisible()

    // Delete older workout
    const deleteBtn = page.locator('button', { hasText: 'Delete' }).first()
    await deleteBtn.click()

    // Verified deleted from state
    expect(apiState.deletedSessionIds).toContain('sess-older-1')
  })

  test('surfaces auto-detected workout in Today tab and allows confirming it', async ({ page }) => {
    const apiState = await setupMockApi(page)
    const inferredSess = {
      id: 'sess-inferred-1',
      routine_id: null,
      started_at: '2026-11-05T19:00:00.000Z',
      ended_at: '2026-11-05T20:30:00.000Z',
      notes: null,
      extra: {
        inferred: true,
        routine_name: 'Badminton Match Play',
        duration_minutes: 90,
        active_energy_kcal: 650,
        avg_hr: 142,
      },
      items: [],
    }
    apiState.sessions = [inferredSess, ...apiState.sessions.filter((s) => !s.extra?.inferred)]

    await page.goto('/')

    // Banner is visible on Today tab
    await expect(page.getByText('Auto-Detected Workout')).toBeVisible()
    await expect(page.getByText('Needs Review')).toBeVisible()
    await expect(page.getByText('Badminton Match Play')).toBeVisible()
    await expect(page.getByText('~90 min')).toBeVisible()
    await expect(page.getByText('650 kcal')).toBeVisible()

    // Confirm the workout
    const confirmBtn = page.getByRole('button', { name: '✓ Confirm / Keep' })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    // Verified banner disappears once confirmed
    await expect(page.getByText('Needs Review')).not.toBeVisible()
    await expect(page.getByText('Auto-Detected Workout')).not.toBeVisible()

    // Verified saved with inferred: false and confirmed: true
    await expect.poll(() => apiState.savedSessions.find((s) => s.id === 'sess-inferred-1')).toBeDefined()
    const saved = apiState.savedSessions.find((s) => s.id === 'sess-inferred-1')
    expect(saved?.extra?.inferred).toBe(false)
    expect(saved?.extra?.confirmed).toBe(true)
  })

  test('allows dismissing an auto-detected workout from Today tab', async ({ page }) => {
    const apiState = await setupMockApi(page)
    const inferredSess = {
      id: 'sess-inferred-2',
      routine_id: null,
      started_at: '2026-11-05T18:00:00.000Z',
      ended_at: '2026-11-05T19:00:00.000Z',
      notes: null,
      extra: {
        inferred: true,
        routine_name: 'Walk / Cardio',
      },
      items: [],
    }
    apiState.sessions = [inferredSess, ...apiState.sessions.filter((s) => !s.extra?.inferred)]

    await page.goto('/')

    await expect(page.getByText('Walk / Cardio')).toBeVisible()

    // Dismiss the workout
    const dismissBtn = page.getByRole('button', { name: '✕ Dismiss Workout' })
    await expect(dismissBtn).toBeVisible()
    await dismissBtn.click()

    // Verified deleted from state
    expect(apiState.deletedSessionIds).toContain('sess-inferred-2')
    await expect(page.getByText('Walk / Cardio')).not.toBeVisible()
  })

  test('displays inferred badge and dismiss control in Progress tab', async ({ page }) => {
    const apiState = await setupMockApi(page)
    const inferredSess = {
      id: 'sess-inferred-3',
      routine_id: null,
      started_at: '2026-11-05T18:00:00.000Z',
      ended_at: '2026-11-05T19:00:00.000Z',
      notes: null,
      extra: {
        inferred: true,
        routine_name: 'Inferred Court Play',
      },
      items: [],
    }
    apiState.sessions = [inferredSess, ...apiState.sessions.filter((s) => !s.extra?.inferred)]

    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    await expect(page.getByText('Inferred Court Play')).toBeVisible()
    await expect(page.getByText('⚡ Inferred from Plan')).toBeVisible()

    // Dismiss button in Progress tab
    const dismissBtn = page.getByRole('button', { name: '✕ Dismiss' })
    await expect(dismissBtn).toBeVisible()
    await dismissBtn.click()

    expect(apiState.deletedSessionIds).toContain('sess-inferred-3')
  })

  test('allows changing workout routine name from Progress tab', async ({ page }) => {
    const apiState = await setupMockApi(page)
    const genericSess = {
      id: 'sess-change-1',
      routine_id: null,
      started_at: '2026-11-05T18:00:00.000Z',
      ended_at: '2026-11-05T19:00:00.000Z',
      notes: null,
      extra: {
        routine_name: 'Gym Session',
      },
      items: [],
    }
    apiState.sessions.unshift(genericSess)

    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    // Click Change button for this session
    const changeBtn = page.getByRole('button', { name: 'Change' }).first()
    await expect(changeBtn).toBeVisible()
    await changeBtn.click()

    // Modal appears
    await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).toBeVisible()

    // Select preset Lower Body A
    const presetBtn = page.getByRole('button', { name: 'Lower Body A' })
    await expect(presetBtn).toBeVisible()
    await presetBtn.click()

    // Select Optimal effort
    const optimalBtn = page.getByRole('button', { name: '🟡 Optimal' })
    await expect(optimalBtn).toBeVisible()
    await optimalBtn.click()

    // Save changes
    const saveBtn = page.getByRole('button', { name: 'Save Changes' })
    await expect(saveBtn).toBeVisible()
    await saveBtn.click()

    // Modal closes and list updates
    await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).not.toBeVisible()
    await expect.poll(() => apiState.savedSessions.find((s) => s.id === 'sess-change-1')?.extra?.routine_name).toBe('Lower Body A')
  })

  test('allows changing an inferred workout from Today tab review banner', async ({ page }) => {
    const apiState = await setupMockApi(page)
    const infSess = {
      id: 'sess-change-today',
      routine_id: null,
      started_at: '2026-11-05T18:00:00.000Z',
      ended_at: '2026-11-05T19:00:00.000Z',
      notes: null,
      extra: {
        inferred: true,
        routine_name: 'Gym Session',
      },
      items: [],
    }
    apiState.sessions = [infSess, ...apiState.sessions.filter((s) => !s.extra?.inferred)]

    await page.goto('/')

    // Banner is visible on Today tab
    await expect(page.getByText('Auto-Detected Workout')).toBeVisible()

    // Click Change
    const changeBtn = page.getByRole('button', { name: 'Change' }).first()
    await expect(changeBtn).toBeVisible()
    await changeBtn.click()

    // Modal opens
    await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).toBeVisible()

    // Pick badminton
    const badmintonPreset = page.getByRole('button', { name: '🏸 Badminton Match Play' })
    await expect(badmintonPreset).toBeVisible()
    await badmintonPreset.click()

    // Save
    const saveBtn = page.getByRole('button', { name: 'Save Changes' })
    await saveBtn.click()

    await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).not.toBeVisible()
    await expect.poll(() => apiState.savedSessions.find((s) => s.id === 'sess-change-today')?.extra?.routine_name).toBe('🏸 Badminton Match Play')
    const saved = apiState.savedSessions.find((s) => s.id === 'sess-change-today')
    expect(saved?.extra?.inferred).toBe(false)
    expect(saved?.extra?.confirmed).toBe(true)
  })

  test('splits an inferred workout using timeline suggestions and launches retroactive set logging', async ({ page }) => {
    const apiState = await setupMockApi(page)
    await page.goto('/')

    await expect(page.getByText('Auto-Detected Workout')).toBeVisible()
    await page.getByRole('button', { name: 'Split' }).first().click()

    await expect(page.getByRole('heading', { name: 'Split Workout Session' })).toBeVisible()
    await expect(page.getByTestId('split-timeline-chart')).toBeVisible()
    await expect(page.getByText(/⌚ Active Watch/)).toBeVisible()
    await expect(page.getByText(/Suggested Split: \d{2}:\d{2} -> \d{2}:\d{2}/)).toBeVisible()

    const barHeights = await page
      .getByTestId('timeline-bin-bar')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    expect(barHeights.length).toBeGreaterThan(0)
    expect(Math.max(...barHeights)).toBeGreaterThan(0)

    const applySplitBtn = page.getByRole('button', { name: 'Apply Suggested Split' }).first()
    await expect(applySplitBtn).toBeVisible()
    const applySplitBox = await applySplitBtn.boundingBox()
    expect(applySplitBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    await applySplitBtn.click()

    // Segment 1 defaults to Gym Class ("Group Core"), Segment 2 defaults to Routine ("Upper Body A")
    const seg2 = page.getByTestId('split-segment-2')
    const lowerBodyBtn = seg2.getByRole('button', { name: /Lower Body A/i })
    const routineBtnBox = await lowerBodyBtn.boundingBox()
    expect(routineBtnBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    const seg1StartBox = await page.getByLabel('Segment 1 Start').boundingBox()
    expect(seg1StartBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    await lowerBodyBtn.click()

    // Live Eir preview metrics appear inside segment card
    await expect(seg2.getByText(/kcal/)).toBeVisible()

    // Click Split & Log Sets
    await page.getByRole('button', { name: 'Split & Log Sets' }).click()

    await expect.poll(() => apiState.splitRequests.length).toBe(1)
    expect(apiState.splitRequests[0].parentId).toBe('00000000-0000-4000-8000-000000000402')
    expect(apiState.splitRequests[0].segments[0].activity_type).toBe('class')
    expect(apiState.splitRequests[0].segments[1].routine_id).toBe('00000000-0000-4000-8000-000000000202')

    // Retroactive workout view opens immediately with preserved timestamps and no stopwatch
    await expect(page.getByTestId('retroactive-log-badge')).toContainText('Retroactive Log -')
    await expect(page.getByTestId('rest-timer-bar')).not.toBeVisible()
    await expect(page.locator('.workout-item h3', { hasText: 'Barbell Squat' })).toBeVisible()

    await page.locator('.set-row input[inputmode="decimal"]').first().fill('80')
    await page.locator('.set-row input[inputmode="numeric"]').first().fill('8')
    await page.getByRole('button', { name: 'Save Sets' }).click()

    await expect.poll(() => apiState.savedSessions.length).toBe(1)
    const saved = apiState.savedSessions[0]
    expect(saved.id).toBe('00000000-0000-4000-8000-000000000902')
    expect(saved.extra.telemetry_locked).toBe(true)
    expect(saved.extra.manual_split).toBe(true)
    expect(saved.extra.avg_hr).toBe(136)
  })

  test('edits start/end times, switches to custom class clearing routine_id, and refreshes Eir telemetry', async ({ page }) => {
    const apiState = await setupMockApi(page)
    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    await page.getByRole('button', { name: 'Change' }).first().click()
    await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).toBeVisible()

    await page.getByLabel('Start Time').fill('09:00')
    await page.getByLabel('End Time').fill('09:35')
    await page.getByRole('button', { name: 'Class', exact: true }).click()
    await page.getByPlaceholder('Enter routine or activity name...').fill('Group Core')

    await page.getByRole('button', { name: 'Refresh Eir Telemetry' }).click()
    await expect.poll(() => apiState.metricsQueries.length).toBeGreaterThan(0)
    await expect(page.getByText('280 kcal')).toBeVisible()

    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect.poll(() => apiState.savedSessions.length).toBe(1)
    const saved = apiState.savedSessions[0]
    expect(saved.routine_id).toBeNull()
    expect(saved.extra.activity_type).toBe('class')
    expect(saved.extra.classification).toBe('class')
    expect(saved.extra.telemetry_locked).toBe(true)
    expect(saved.extra.active_energy_kcal).toBe(280)
  })

  test('shows logged class badge on Today card while keeping scheduled strength lift actionable', async ({ page }) => {
    const apiState = await setupMockApi(page)
    apiState.sessions = [
      {
        id: '00000000-0000-4000-8000-000000000777',
        routine_id: null,
        started_at: '2026-11-02T05:00:00.000Z',
        ended_at: '2026-11-02T05:30:00.000Z',
        notes: null,
        extra: {
          routine_name: 'Group Core',
          activity_type: 'class',
          classification: 'class',
          inferred: false,
          confirmed: true,
          duration_minutes: 30,
          active_energy_kcal: 220,
        },
        items: [],
      },
    ]

    await page.goto('/')

    await expect(page.getByTestId('logged-class-chips')).toContainText('Group Core (30m) completed today')
    await expect(page.getByText('Pending', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Start Workout/i })).toBeVisible()
    await expect(page.getByTestId('completed-workout-card')).not.toBeVisible()
  })

  test('allows retroactive Log Sets on a confirmed routine session without items', async ({ page }) => {
    const apiState = await setupMockApi(page)
    const originalStarted = '2026-11-02T06:00:00.000Z'
    const originalEnded = '2026-11-02T06:35:00.000Z'
    apiState.sessions = [
      {
        id: '00000000-0000-4000-8000-000000000888',
        routine_id: '00000000-0000-4000-8000-000000000202',
        started_at: originalStarted,
        ended_at: originalEnded,
        notes: 'Split strength slice',
        extra: {
          routine_name: 'Lower Body A',
          activity_type: 'gym',
          inferred: false,
          confirmed: true,
          telemetry_locked: true,
          manual_split: true,
          avg_hr: 138,
          active_energy_kcal: 245,
        },
        items: [],
      },
    ]

    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    await page.getByRole('button', { name: 'Log Sets' }).click()
    await expect(page.getByTestId('retroactive-log-badge')).toBeVisible()

    await page.locator('.set-row input[inputmode="decimal"]').first().fill('90')
    await page.locator('.set-row input[inputmode="numeric"]').first().fill('6')
    await page.getByRole('button', { name: 'Save Sets' }).click()

    await expect.poll(() => apiState.savedSessions.length).toBe(1)
    const saved = apiState.savedSessions[0]
    expect(saved.id).toBe('00000000-0000-4000-8000-000000000888')
    expect(saved.started_at).toBe(originalStarted)
    expect(saved.ended_at).toBe(originalEnded)
    expect(saved.extra.telemetry_locked).toBe(true)
    expect(saved.extra.avg_hr).toBe(138)
    await expect(page.getByRole('button', { name: 'Edit Sets' })).toBeVisible()
  })

  test('clears prior HR, effort, and energy metrics when Refresh Eir Telemetry returns nulls', async ({ page }) => {
    const apiState = await setupMockApi(page)
    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' }).click()

    await page.getByRole('button', { name: 'Change' }).first().click()
    await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).toBeVisible()

    const refreshBtn = page.getByRole('button', { name: 'Refresh Eir Telemetry' })
    const refreshBox = await refreshBtn.boundingBox()
    expect(refreshBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    const startBox = await page.getByLabel('Start Time').boundingBox()
    expect(startBox?.height ?? 0).toBeGreaterThanOrEqual(44)

    await page.getByLabel('Start Time').fill('09:00')
    await page.getByLabel('End Time').fill('09:08')
    await refreshBtn.click()
    await expect.poll(() => apiState.metricsQueries.length).toBeGreaterThan(0)

    const dialog = page.locator('.modal-card')
    await expect(dialog.getByText('⏱️ 8m')).toBeVisible()
    await expect(dialog.getByText(/157 bpm/)).not.toBeVisible()
    await expect(dialog.getByText(/91 kcal/)).not.toBeVisible()

    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect.poll(() => apiState.savedSessions.length).toBe(1)
    const saved = apiState.savedSessions[0]
    expect(saved.extra.avg_hr).toBeUndefined()
    expect(saved.extra.peak_hr).toBeUndefined()
    expect(saved.extra.rpe).toBeUndefined()
    expect(saved.extra.trimp).toBeUndefined()
    expect(saved.extra.hr_zones).toBeUndefined()
    expect(saved.extra.hr_recovery_60s).toBeUndefined()
    expect(saved.extra.step_count).toBeUndefined()
    expect(saved.extra.active_energy_kcal).toBeUndefined()
    expect(saved.extra.effort_rating).toBeUndefined()
  })
})
