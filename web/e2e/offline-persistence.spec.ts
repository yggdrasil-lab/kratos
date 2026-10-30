import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Offline and Persistence (IndexedDB)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('restores workout in progress from IndexedDB draft upon page reload', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Train workout' }).click()

    // Start empty workout
    await page.getByRole('button', { name: 'Start empty session' }).click()

    // Add Barbell Squat
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await modal.locator('input[placeholder="Search exercises..."]').fill('Squat')
    await modal.locator('.exercise-item', { hasText: 'Barbell Squat' }).click()

    // Fill in set
    const weightInput = page.locator('.set-row input[placeholder*="Weight"]').first()
    const repsInput = page.locator('.set-row input[placeholder*="Reps"]').first()
    await weightInput.fill('100')
    await repsInput.fill('5')

    // Reload the page
    await page.reload()

    // After reload, verify draft persistence
    // Either banner is shown (if default tab is week) or active dot is present
    await expect(page.locator('.active-workout-dot')).toBeVisible()

    // Navigate to Train tab
    await bottomNav.getByRole('button', { name: 'Train workout' }).click()

    // Current workout with Barbell Squat and inputs preserved
    await expect(page.getByRole('heading', { name: 'Current Workout' })).toBeVisible()
    await expect(page.locator('.workout-item h3')).toHaveText('Barbell Squat')
    await expect(page.locator('.set-row input[placeholder*="Weight"]').first()).toHaveValue('100')
    await expect(page.locator('.set-row input[placeholder*="Reps"]').first()).toHaveValue('5')
  })

  test('queues session to local outbox when network sync fails', async ({ page }) => {
    // Override PUT /api/sessions/* to return network failure / 500
    await page.route('**/api/sessions/**', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Train workout' }).click()
    await page.getByRole('button', { name: 'Start empty session' }).click()

    // Add exercise
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await modal.locator('.exercise-item', { hasText: 'Barbell Squat' }).click()

    // Finish session while network is failing
    await page.getByRole('button', { name: 'Finish Workout' }).click()

    // Should indicate pending / offline in header badge
    await expect(page.locator('.status-badge')).toBeVisible()
    // Verify Force Sync or pending count is rendered
    await expect(page.locator('header')).toContainText(/pending|Offline/i)
  })
})
