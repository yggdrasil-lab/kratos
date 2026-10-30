import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Train Flow: Routine Workout', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('starts workout from planned routine with pre-populated exercises and targets', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Train workout' }).click()

    // Routine button is available
    const routineBtn = page.getByRole('button', { name: /Upper Body A/i })
    await expect(routineBtn).toBeVisible()
    await expect(routineBtn).toContainText('2 exercises planned')

    // Start routine
    await routineBtn.click()

    // Current workout should have both exercises pre-staged
    await expect(page.getByRole('heading', { name: 'Current Workout' })).toBeVisible()
    const workoutItems = page.locator('.workout-item')
    await expect(workoutItems).toHaveCount(2)
    await expect(workoutItems.nth(0).locator('h3')).toHaveText('Bench Press (Dumbbell)')
    await expect(workoutItems.nth(1).locator('h3')).toHaveText('Overhead Press')

    // Verify target placeholders are rendered on inputs
    const benchWeightInput = workoutItems.nth(0).locator('.set-row input[placeholder="30"]')
    const benchRepsInput = workoutItems.nth(0).locator('.set-row input[placeholder="8"]')
    await expect(benchWeightInput.first()).toBeVisible()
    await expect(benchRepsInput.first()).toBeVisible()

    // Enter actuals for first set
    await benchWeightInput.first().fill('32')
    await benchRepsInput.first().fill('9')

    // Finish session
    await page.getByRole('button', { name: 'Finish Workout' }).click()

    // Verify redirected to History
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible()
  })
})
