import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Routine Workout Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('starts workout from planned routine with pre-populated exercises and targets', async ({ page }) => {
    // Start workout button
    const startBtn = page.getByRole('button', { name: /Start Workout/i })
    await expect(startBtn).toBeVisible()
    await startBtn.click()

    // Current workout should have exercises pre-staged
    await expect(page.getByRole('heading', { name: /Upper Body A|Current Workout/i })).toBeVisible()
    const workoutItems = page.locator('.workout-item')
    await expect(workoutItems.first()).toBeVisible()

    // Enter actuals for first set
    const setRow = page.locator('.set-row').filter({ has: page.locator('input') }).first()
    const weightInput = setRow.locator('input').first()
    const repsInput = setRow.locator('input').nth(1)
    await weightInput.fill('32')
    await repsInput.fill('9')

    // Finish session -> opens Effort Debrief
    await page.getByRole('button', { name: 'Finish Workout' }).click()
    await expect(page.getByRole('heading', { name: 'Workout Complete!' })).toBeVisible()

    // Save and Finish
    await page.getByRole('button', { name: 'Save and Finish' }).click()

    // Verifies modal closes and returns to Today view
    await expect(page.getByText(/Today's Training/i)).toBeVisible()
  })
})
