import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('History View', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('displays completed sessions in history', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Workout history' }).click()

    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible()
    const historyCards = page.locator('.history-card')
    await expect(historyCards).toHaveCount(1)
    await expect(historyCards.first().locator('h3')).toHaveText('Upper Body A')
    await expect(historyCards.first().locator('.badge-completed')).toHaveText('✓ Completed')
    await expect(historyCards.first().getByText('Bench Press (Dumbbell)')).toBeVisible()
  })

  test('opens delete confirmation modal and deletes session', async ({ page }) => {
    const apiState = await setupMockApi(page)
    await page.goto('/')

    const bottomNav = page.locator('nav.bottom-nav')
    await bottomNav.getByRole('button', { name: 'Workout history' }).click()

    const historyCards = page.locator('.history-card')
    await expect(historyCards).toHaveCount(1)

    // Click delete icon button
    const deleteBtn = historyCards.first().locator('button[title="Delete Session"]')
    await deleteBtn.click()

    // Confirmation modal
    const deleteModal = page.locator('.modal-overlay')
    await expect(deleteModal).toBeVisible()
    await expect(deleteModal.locator('h3')).toHaveText('Delete Workout Session?')

    // Confirm deletion
    const confirmBtn = deleteModal.getByRole('button', { name: 'Delete' })
    await confirmBtn.click()

    // Modal closes and card is removed
    await expect(deleteModal).not.toBeVisible()
    await expect(historyCards).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'No workouts logged yet' })).toBeVisible()
    expect(apiState.deletedSessionIds).toContain('sess-history-1')
  })
})
