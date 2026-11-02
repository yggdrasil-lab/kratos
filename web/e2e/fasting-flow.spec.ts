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

    // 3. Fill in energy and notes
    await modal.getByRole('button', { name: /High/i }).click()
    const notesInput = modal.getByPlaceholder(/Notes/i)
    await notesInput.fill('Felt great during 16h fast, drank black coffee')

    // 4. Save check-in
    await modal.getByRole('button', { name: 'Save Check-In' }).click()
    await expect(modal).not.toBeVisible()

    // 5. Verify FastingCard displays badge, energy, and notes
    await expect(page.getByText('✓ Completed')).toBeVisible()
    await expect(page.getByText(/Logged: Energy high • Headache none • "Felt great during 16h fast, drank black coffee"/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  test('edit modal pre-populates existing check-in data and notes without wiping', async ({ page }) => {
    // Log initial fast
    await page.getByRole('button', { name: 'Log Fast' }).click()
    const modal = page.locator('.modal-backdrop')
    await modal.getByRole('button', { name: /High/i }).click()
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
    await expect(page.getByText(/Logged: Energy high • Headache none • "Felt great during 16h fast, drank black coffee \+ electrolytes"/i)).toBeVisible()
  })

  test('displays fasting log with notes in Progress tab history', async ({ page }) => {
    // Log fast with notes
    await page.getByRole('button', { name: 'Log Fast' }).click()
    const modal = page.locator('.modal-backdrop')
    await modal.getByRole('button', { name: /High/i }).click()
    await modal.getByPlaceholder(/Notes/i).fill('Smooth 16h fast')
    await modal.getByRole('button', { name: 'Save Check-In' }).click()
    await expect(modal).not.toBeVisible()

    // Navigate to Progress tab
    const bottomNav = page.locator('nav.bottom-nav')
    const progressBtn = bottomNav.getByRole('button', { name: 'Progress, 80kg Goal and Activity' })
    await progressBtn.click()

    // Verify Fasting History stream
    await expect(page.getByRole('heading', { name: /Fasting History/i })).toBeVisible()
    await expect(page.getByText(/Energy: high • Headache: none • "Smooth 16h fast"/i)).toBeVisible()
  })
})
