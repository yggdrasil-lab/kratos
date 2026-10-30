import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Train Flow: Free Workout', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('starts empty session, adds exercise, logs sets, and finishes workout', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Train workout' }).click()

    // Ready to train view
    await expect(page.getByRole('heading', { name: 'Ready to train?' })).toBeVisible()
    const startEmptyBtn = page.getByRole('button', { name: 'Start empty session' })
    await startEmptyBtn.click()

    // Current workout view
    await expect(page.getByRole('heading', { name: 'Current Workout' })).toBeVisible()
    await expect(page.getByText('No exercises added yet.')).toBeVisible()

    // Open Exercise Picker
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    // Search and select exercise
    const searchInput = modal.locator('input[placeholder="Search exercises..."]')
    await searchInput.fill('Bench')
    const exerciseItem = modal.locator('.exercise-item', { hasText: 'Bench Press (Dumbbell)' })
    await expect(exerciseItem).toBeVisible()
    await exerciseItem.click()
    await expect(modal).not.toBeVisible()

    // Exercise added to workout
    await expect(page.locator('.workout-item h3')).toHaveText('Bench Press (Dumbbell)')

    // Fill in set 1
    const weightInputs = page.locator('.set-row input[placeholder*="Weight"]')
    const repsInputs = page.locator('.set-row input[placeholder*="Reps"]')
    await expect(weightInputs).toHaveCount(1)
    await weightInputs.first().fill('32.5')
    await repsInputs.first().fill('10')

    // Add set 2
    await page.getByRole('button', { name: '+ Add Set' }).click()
    await expect(page.locator('.set-row')).toHaveCount(3) // 1 header row + 2 set rows
    await expect(page.locator('.set-number')).toHaveCount(2)
    await expect(page.locator('.set-number').nth(1)).toHaveText('2')

    // Fill in set 2
    await weightInputs.nth(1).fill('35')
    await repsInputs.nth(1).fill('8')

    // Navigate to Week tab: verify in-progress banner and dot
    await bottomNav.getByRole('button', { name: 'Weekly workout schedule' }).click()
    const banner = page.locator('.active-workout-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Workout In Progress')
    await expect(page.locator('.active-workout-dot')).toBeVisible()

    // Click resume on banner
    await banner.click()
    await expect(page.getByRole('heading', { name: 'Current Workout' })).toBeVisible()

    // Finish workout
    const finishBtn = page.getByRole('button', { name: 'Finish Workout' })
    await finishBtn.click()

    // Navigates to history tab automatically upon finish
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible()
    await expect(page.locator('.active-workout-banner')).not.toBeVisible()
    await expect(page.locator('.active-workout-dot')).not.toBeVisible()
  })
})
