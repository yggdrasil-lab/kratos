import { test, expect, devices } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

const PLATFORMS = [
  {
    name: 'ios',
    options: {
      viewport: devices['iPhone 14'].viewport,
      userAgent: devices['iPhone 14'].userAgent,
      deviceScaleFactor: devices['iPhone 14'].deviceScaleFactor,
      isMobile: devices['iPhone 14'].isMobile,
      hasTouch: devices['iPhone 14'].hasTouch,
    },
  },
  {
    name: 'android',
    options: {
      viewport: devices['Pixel 7'].viewport,
      userAgent: devices['Pixel 7'].userAgent,
      deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
      isMobile: devices['Pixel 7'].isMobile,
      hasTouch: devices['Pixel 7'].hasTouch,
    },
  },
]

for (const { name: platform, options } of PLATFORMS) {
  test.describe(`Visual Inspection - ${platform.toUpperCase()}`, () => {
    test.use({
      ...options,
    })

    test.beforeEach(async ({ page }) => {
      await setupMockApi(page)
      await page.goto('/')
    })

    test(`captures full screen progression on ${platform}`, async ({ page }) => {
      // 1. Today View
      await expect(page.locator('header h1')).toHaveText('Kratos')
      await expect(page.getByText("Today's Training")).toBeVisible()
      await page.screenshot({
        path: `screenshots/${platform}/01-today-view.png`,
        fullPage: true,
      })

      // 2. Fasting Check-in Modal
      const checkInBtn = page.getByRole('button', { name: /Log Fast/i }).first()
      await expect(checkInBtn).toBeVisible()
      await checkInBtn.click()
      await expect(page.getByRole('heading', { name: 'Fasting Check-In' })).toBeVisible()
      await page.waitForTimeout(350)
      await page.screenshot({
        path: `screenshots/${platform}/02-fasting-modal.png`,
      })
      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.waitForTimeout(200)

      // 3. Active Workout Logging Screen
      const startBtn = page.getByRole('button', { name: /Start Workout/i }).first()
      await expect(startBtn).toBeVisible()
      await startBtn.click()
      await expect(page.getByRole('heading', { name: /Upper Body A|Current Workout/i })).toBeVisible()
      await page.waitForTimeout(200)
      await page.screenshot({
        path: `screenshots/${platform}/03-active-workout.png`,
        fullPage: true,
      })

      // 4. Effort Debrief Modal
      const finishBtn = page.getByRole('button', { name: 'Finish Workout' })
      await finishBtn.click()
      await expect(page.getByRole('heading', { name: 'Workout Complete!' })).toBeVisible()
      await page.waitForTimeout(350)
      await page.screenshot({
        path: `screenshots/${platform}/04-effort-debrief-modal.png`,
      })
      // Save debrief to return to home
      await page.getByRole('button', { name: 'Save and Finish' }).click()

      // 5. Progress View
      const progressTabBtn = page.locator('nav.bottom-nav').getByRole('button', { name: /Progress/i })
      await progressTabBtn.click()
      await expect(page.getByRole('heading', { name: 'Progress and Momentum' })).toBeVisible()
      await page.screenshot({
        path: `screenshots/${platform}/05-progress-view.png`,
        fullPage: true,
      })
    })
  })
}
