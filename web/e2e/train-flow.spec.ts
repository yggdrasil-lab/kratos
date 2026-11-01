import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Train Flow and Effort Debrief', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('starts workout from Today, logs sets, debriefs effort, and saves session', async ({ page }) => {
    // Today view has the staged workout button
    const startBtn = page.getByRole('button', { name: /Start Workout/i })
    await expect(startBtn).toBeVisible()
    await startBtn.click()

    // Current workout view
    await expect(page.getByRole('heading', { name: /Upper Body A|Current Workout/i })).toBeVisible()

    // Add another exercise
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    // Search and select Barbell Squat
    const searchInput = modal.locator('input[placeholder="Search exercises..."]')
    await searchInput.fill('Squat')
    const exerciseItem = modal.locator('.exercise-item', { hasText: 'Barbell Squat' })
    await expect(exerciseItem).toBeVisible()
    await exerciseItem.click()
    await expect(modal).not.toBeVisible()

    // Exercise added to workout
    await expect(page.locator('.workout-item h3', { hasText: 'Barbell Squat' })).toBeVisible()

    // Fill in set
    const weightInputs = page.locator('.set-row input[placeholder*="Weight"]')
    const repsInputs = page.locator('.set-row input[placeholder*="Reps"]')
    await weightInputs.first().fill('32.5')
    await repsInputs.first().fill('10')

    // Finish workout - opens Effort Debrief Modal
    const finishBtn = page.getByRole('button', { name: 'Finish Workout' })
    await finishBtn.click()

    // Verify Effort Debrief Modal appears
    await expect(page.getByRole('heading', { name: 'Workout Complete!' })).toBeVisible()
    await expect(page.getByText('How much effort did this take?')).toBeVisible()

    // Select Optimal effort
    const optimalBtn = page.getByRole('button', { name: /Just Right \/ Optimal/i })
    await expect(optimalBtn).toBeVisible()
    await optimalBtn.click()

    // Select quick tag
    const feltStrongTag = page.getByRole('button', { name: '💪 Felt Strong' })
    await expect(feltStrongTag).toBeVisible()
    await feltStrongTag.click()

    // Complete and save
    const saveBtn = page.getByRole('button', { name: 'Save and Finish' })
    await saveBtn.click()

    // Modal closes and returns to Today view
    await expect(page.getByRole('heading', { name: 'Workout Complete!' })).not.toBeVisible()
    await expect(page.getByText(/Today's Training/i)).toBeVisible()
  })
})
