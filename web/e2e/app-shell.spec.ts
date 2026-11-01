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
    await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible()
  })

  test('checks for PWA updates on demand and on visibilitychange and surfaces update banner', async ({ page }) => {
    await page.evaluate(() => {
      const state = {
        updateCalls: 0,
        skipWaitingPosted: false,
        hasWaiting: false,
      }
      ;(window as unknown as Record<string, unknown>).__swTestState = state
      const fakeReg = {
        get waiting() {
          return state.hasWaiting
            ? {
                postMessage: (msg: { type?: string }) => {
                  if (msg?.type === 'SKIP_WAITING') {
                    state.skipWaitingPosted = true
                  }
                },
              }
            : null
        },
        installing: null,
        update: async () => {
          state.updateCalls += 1
        },
      }
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          getRegistration: async () => fakeReg,
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      })
    })

    const checkBtn = page.getByRole('button', { name: 'Check for updates' })
    await checkBtn.click()
    await expect(checkBtn).toHaveText('Up to date')

    // Simulate visibilitychange revalidation finding a waiting SW
    await page.evaluate(() => {
      const state = (window as unknown as Record<string, { hasWaiting: boolean }>).__swTestState
      state.hasWaiting = true
      document.dispatchEvent(new Event('visibilitychange'))
    })

    const banner = page.getByTestId('pwa-update-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('New version available')

    await banner.getByRole('button', { name: 'Reload to update' }).click()
    const skipSent = await page.evaluate(() => {
      return (window as unknown as Record<string, { skipWaitingPosted: boolean }>).__swTestState.skipWaitingPosted
    })
    expect(skipSent).toBe(true)
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
