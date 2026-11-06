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
    apiState.sessions.unshift(inferredSess)

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
    apiState.sessions.unshift(inferredSess)

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
    apiState.sessions.unshift(inferredSess)

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
    apiState.sessions.unshift(infSess)

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
})
