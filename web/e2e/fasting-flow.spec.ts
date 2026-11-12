import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Fasting Check-In Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('logs fasting with notes and renders them on the Today card', async ({ page }) => {
    // 1. Locate FastingCard and click "Log Fast"
    const logFastBtn = page.getByRole('button', { name: 'Log Fast' })
    await expect(logFastBtn).toBeVisible()
    await logFastBtn.click()

    // 2. FastingCheckInModal opens
    const modal = page.locator('.modal-backdrop')
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('heading', { name: 'Fasting Check-In' })).toBeVisible()

    // 3. Fill in notes
    const notesInput = modal.getByPlaceholder(/Notes/i)
    await notesInput.fill('Felt great during 16h fast, drank black coffee')

    // 4. Save check-in
    await modal.getByRole('button', { name: 'Save Check-In' }).click()
    await expect(modal).not.toBeVisible()

    // 5. Verify FastingCard displays badge, notes
    await expect(page.getByText('✓ Completed')).toBeVisible()
    await expect(page.getByText(/Logged: "Felt great during 16h fast, drank black coffee"/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  test('edit modal pre-populates existing check-in data and notes without wiping', async ({ page }) => {
    // Log initial fast
    await page.getByRole('button', { name: 'Log Fast' }).click()
    const modal = page.locator('.modal-backdrop')
    await modal.getByPlaceholder(/Notes/i).fill('Felt great during 16h fast, drank black coffee')
    await modal.getByRole('button', { name: 'Save Check-In' }).click()
    await expect(modal).not.toBeVisible()

    // Click Edit
    const editBtn = page.getByRole('button', { name: 'Edit' })
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    // Verify modal pre-populates existing values
    await expect(modal).toBeVisible()
    const notesInput = modal.getByPlaceholder(/Notes/i)
    await expect(notesInput).toHaveValue('Felt great during 16h fast, drank black coffee')

    // Update note with electrolytes
    await notesInput.fill('Felt great during 16h fast, drank black coffee + electrolytes')
    await modal.getByRole('button', { name: 'Save Check-In' }).click()
    await expect(modal).not.toBeVisible()

    // Verify card displays updated note
    await expect(page.getByText(/Logged: "Felt great during 16h fast, drank black coffee \+ electrolytes"/i)).toBeVisible()
  })

  test('displays fasting log with notes in Progress tab history', async ({ page }) => {
    // Log fast with notes
    await page.getByRole('button', { name: 'Log Fast' }).click()
    const modal = page.locator('.modal-backdrop')
    await modal.getByPlaceholder(/Notes/i).fill('Smooth 16h fast')
    await modal.getByRole('button', { name: 'Save Check-In' }).click()
    await expect(modal).not.toBeVisible()

    // Navigate to Progress tab
    const bottomNav = page.locator('nav.bottom-nav')
    const progressBtn = bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' })
    await progressBtn.click()

    // Verify Fasting History stream
    await expect(page.getByRole('heading', { name: /Fasting History/i })).toBeVisible()
    await expect(page.getByText(/"Smooth 16h fast"/i)).toBeVisible()
  })

  test('hydrates fasting check-in from server biometrics across devices', async ({ page }) => {
    // Override /api/biometrics/today to return server-side fasting feedback
    const todayStr = await page.evaluate(() => new Date().toISOString().split('T')[0])
    await page.route('**/api/biometrics/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: todayStr,
          latest_weight_kg: 86.02,
          fasting: {
            id: 'fb-server-123',
            date: todayStr,
            feedback_type: 'fasting',
            rating: 'completed',
            score: 5.0,
            tags: ['energy:high'],
            payload: {
              target_window: '16:8',
              energy: 'high',
              headache: 'none',
            },
            notes: 'Logged remotely from PC browser',
            logged_at: new Date().toISOString(),
          },
        }),
      })
    })

    // Reload page simulating fresh device opening app
    await page.goto('/')

    // FastingCard should immediately reflect the server-synced fast
    await expect(page.getByText('✓ Completed')).toBeVisible()
    await expect(page.getByText(/Logged: Energy high • Headache none • "Logged remotely from PC browser"/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  test('renders smart autoregulation rationale and protocol badge', async ({ page }) => {
    await expect(page.getByText('Smart Autoregulation')).toBeVisible()
    await expect(page.getByText(/Court session scheduled/i)).toBeVisible()
    await expect(page.getByText('🟢 Primed')).toBeVisible()
    await expect(page.getByText('⚡ AI Synthesized')).toBeVisible()
    await expect(page.getByText(/Panda Lab \(Circadian TRE\)/i)).toBeVisible()

    // Expand research citation
    await page.getByText(/Panda Lab \(Circadian TRE\)/i).click()
    await expect(page.getByText(/8-10h feeding window ending 3-4h prior to sleep/i)).toBeVisible()
  })

  test('adapts protocol with AI modal and custom context', async ({ page }) => {
    const adaptBtn = page.getByTitle('Adapt protocol with AI sports physiology')
    await expect(adaptBtn).toBeVisible()
    await adaptBtn.click()

    // FastingAiModal opens
    const modal = page.locator('.modal-backdrop')
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('heading', { name: 'Adaptive Fasting Synthesizer' })).toBeVisible()

    // Type custom context and submit
    const textarea = modal.locator('textarea')
    await textarea.fill('Meeting moved, workout shifted to 11am')
    await modal.getByRole('button', { name: 'Synthesize with AI' }).click()

    // Verify modal closes and updated protocol appears
    await expect(modal).not.toBeVisible()
    await expect(page.getByText('14:10 Shifted Schedule Protocol')).toBeVisible()
    await expect(page.getByText('11:00 AM - 9:00 PM')).toBeVisible()
  })
})
