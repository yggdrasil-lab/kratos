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

  test('switches tabs between Today and Progress', async ({ page }) => {
    const bottomNav = page.locator('nav.bottom-nav')
    await expect(bottomNav).toBeVisible()

    const todayBtn = bottomNav.getByRole('button', { name: 'Today dashboard and workout' })
    const progressBtn = bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' })

    // Default tab is Today
    await expect(todayBtn).toHaveClass(/active/)
    await expect(page.getByText(/Today's Training/i)).toBeVisible()
    await expect(page.getByText(/Fasting and Fueling/i)).toBeVisible()

    // Switch to Progress tab
    await progressBtn.click()
    await expect(progressBtn).toHaveClass(/active/)
    await expect(todayBtn).not.toHaveClass(/active/)
    await expect(page.getByRole('heading', { name: 'Progress and Momentum' })).toBeVisible()
    await expect(page.getByText('Goal: Reach 80 kg')).toBeVisible()

    // Switch back to Today tab
    await todayBtn.click()
    await expect(todayBtn).toHaveClass(/active/)
    await expect(progressBtn).not.toHaveClass(/active/)
    await expect(page.getByText(/Today's Training/i)).toBeVisible()
  })
})
