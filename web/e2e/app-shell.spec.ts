import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('App Shell and Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('renders header and sync status badge', async ({ page }) => {
    await expect(page.locator('header h1')).toHaveText('Kratos')
    await expect(page.locator('.status-badge')).toBeVisible()
  })

  test('switches tabs between Week, Train, and History', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await expect(bottomNav).toBeVisible()

    const trainBtn = bottomNav.getByRole('button', { name: 'Train workout' })
    const weekBtn = bottomNav.getByRole('button', { name: 'Weekly workout schedule' })
    const historyBtn = bottomNav.getByRole('button', { name: 'Workout history' })

    // Default tab is Week
    await expect(weekBtn).toHaveClass(/active/)
    await expect(page.getByRole('heading', { name: 'Weekly Schedule' })).toBeVisible()

    // Switch to Train tab
    await trainBtn.click()
    await expect(trainBtn).toHaveClass(/active/)
    await expect(weekBtn).not.toHaveClass(/active/)
    await expect(page.getByRole('heading', { name: 'Ready to train?' })).toBeVisible()

    // Switch to History tab
    await historyBtn.click()
    await expect(historyBtn).toHaveClass(/active/)
    await expect(trainBtn).not.toHaveClass(/active/)
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible()
  })
})
