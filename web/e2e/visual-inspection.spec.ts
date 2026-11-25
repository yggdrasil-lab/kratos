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
  {
    name: 'desktop',
    options: {
      viewport: { width: 1280, height: 800 },
    },
  },
]

async function captureSplitModalWithAssertions(page: import('@playwright/test').Page, platform: string) {
  const splitBtn = page.getByRole('button', { name: 'Split' }).first()
  if (!(await splitBtn.isVisible())) return
  await splitBtn.click()
  await expect(page.getByRole('heading', { name: 'Split Workout Session' })).toBeVisible()
  await expect(page.getByTestId('timeline-bin-bar').first()).toBeVisible()
  await page.waitForTimeout(450)

  const barHeights = await page
    .getByTestId('timeline-bin-bar')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  expect(barHeights.length).toBeGreaterThan(0)
  expect(Math.max(...barHeights)).toBeGreaterThan(0)

  const splitTitle = page.getByText(/Suggested Split: \d{2}:\d{2} -> \d{2}:\d{2}/).first()
  await expect(splitTitle).toBeVisible()
  const overflow = await splitTitle.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(overflow).toBe(false)

  const applyBtnBox = await page.getByRole('button', { name: 'Apply Suggested Split' }).first().boundingBox()
  expect(applyBtnBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  const routineBtnBox = await page
    .getByTestId('split-segment-2')
    .getByRole('button', { name: /Lower Body A/i })
    .boundingBox()
  expect(routineBtnBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  const segStartBox = await page.getByLabel('Segment 1 Start').boundingBox()
  expect(segStartBox?.height ?? 0).toBeGreaterThanOrEqual(44)

  await page.screenshot({ path: `screenshots/${platform}/07-split-session-modal.png` })
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(200)
}

async function captureEditModalWithAssertions(
  page: import('@playwright/test').Page,
  progressTabBtn: import('@playwright/test').Locator,
  platform: string
) {
  await progressTabBtn.click()
  const changeBtn = page.getByRole('button', { name: 'Change' }).first()
  if (!(await changeBtn.isVisible())) return
  await changeBtn.click()
  await expect(page.getByRole('heading', { name: 'Edit Workout Details' })).toBeVisible()
  await page.waitForTimeout(450)

  const refreshBox = await page.getByRole('button', { name: 'Refresh Eir Telemetry' }).boundingBox()
  expect(refreshBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  const startInputBox = await page.getByLabel('Start Time').boundingBox()
  expect(startInputBox?.height ?? 0).toBeGreaterThanOrEqual(44)

  await page.screenshot({ path: `screenshots/${platform}/08-edit-session-modal.png` })
  await page.getByRole('button', { name: 'Cancel' }).click()
}

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
      // 1. Today View & Theme System Invariants
      const themeTokens = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement)
        return {
          theme: document.documentElement.dataset.theme,
          accent: rootStyle.getPropertyValue('--ui-accent').trim(),
          radiusCard: rootStyle.getPropertyValue('--ui-radius-card').trim(),
        }
      })
      expect(themeTokens.theme).toBe('kratos')
      expect(themeTokens.accent).toBe('244 63 94')
      expect(themeTokens.radiusCard).toBe('4px')
      await expect(page.locator('header h1')).toHaveText('Kratos')
      await expect(page.getByText("Today's Training")).toBeVisible()
      const inferredTime = page.getByTestId('inferred-session-time-range').first()
      await expect(inferredTime).toBeVisible()
      const inferredOverflow = await inferredTime.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
      expect(inferredOverflow).toBe(false)
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
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.waitForTimeout(200)

      // 3. Active Workout Logging Screen
      const startBtn = page.getByRole('button', { name: /Start Workout/i }).first()
      await expect(startBtn).toBeVisible()
      await startBtn.click()
      await expect(page.getByRole('heading', { name: /Upper Body A|Current Workout/i })).toBeVisible()
      const workoutPadBottom = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector('.kratos-active-workout-section')!).paddingBottom)
      )
      expect(workoutPadBottom).toBeGreaterThanOrEqual(110)
      await page.waitForTimeout(200)
      await page.screenshot({
        path: `screenshots/${platform}/03-active-workout.png`,
        fullPage: true,
      })

      // 4. Effort Debrief Modal
      await page.getByRole('button', { name: 'Finish Workout' }).click()
      await expect(page.getByRole('heading', { name: 'Workout Complete!' })).toBeVisible()
      await page.waitForTimeout(350)
      await page.screenshot({ path: `screenshots/${platform}/04-effort-debrief-modal.png` })
      await page.getByRole('button', { name: 'Save and Finish' }).click()

      // 5. Progress View
      const progressTabBtn = page.locator('nav.bottom-nav').getByRole('button', { name: /Progress/i })
      await progressTabBtn.click()
      await expect(page.getByRole('heading', { name: 'Progress and Momentum' })).toBeVisible()
      const sessionTime = page.getByTestId('session-time-range').first()
      await expect(sessionTime).toBeVisible()
      const sessionTimeOverflow = await sessionTime.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
      expect(sessionTimeOverflow).toBe(false)
      await page.screenshot({ path: `screenshots/${platform}/05-progress-view.png`, fullPage: true })

      // 6. Workout AI Modal
      await page.locator('nav.bottom-nav').getByRole('button', { name: /Today/i }).click()
      await expect(page.getByText("Today's Training")).toBeVisible()
      const adaptBtn = page.getByTitle('Autoregulate training with AI sports physiology')
      if (await adaptBtn.isVisible()) {
        await adaptBtn.click()
        await expect(page.getByRole('heading', { name: 'Adaptive Workout Synthesizer' })).toBeVisible()
        await page.waitForTimeout(350)
        await page.screenshot({ path: `screenshots/${platform}/06-workout-ai-modal.png` })
        await page.getByRole('button', { name: 'Cancel' }).click()
        await page.waitForTimeout(200)
      }

      // 7 & 8. Split & Edit Modals with geometry invariants
      await captureSplitModalWithAssertions(page, platform)
      await captureEditModalWithAssertions(page, progressTabBtn, platform)
    })
  })
}
