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
})
