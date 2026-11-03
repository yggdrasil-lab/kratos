import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Offline and Persistence (IndexedDB)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('restores workout in progress from IndexedDB draft upon page reload', async ({ page }) => {
    // Start workout
    await page.getByRole('button', { name: /Start Workout/i }).click()

    // Add Barbell Squat
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await modal.locator('input[placeholder="Search exercises..."]').fill('Squat')
    await modal.locator('.exercise-item', { hasText: 'Barbell Squat' }).click()

    // Fill in set
    const weightInput = page.locator('.set-row input[placeholder*="Weight"]').first()
    const repsInput = page.locator('.set-row input[placeholder*="Reps"]').first()
    await weightInput.fill('100')
    await repsInput.fill('5')

    // Reload the page
    await page.reload()

    // After reload, verify draft persistence and active dot
    await expect(page.locator('.active-workout-dot')).toBeVisible()

    // Current workout with Barbell Squat and inputs preserved
    await expect(page.getByRole('heading', { name: /Upper Body A|Current Workout/i })).toBeVisible()
    await expect(page.locator('.workout-item h3', { hasText: 'Barbell Squat' })).toBeVisible()
    await expect(page.locator('.set-row input[placeholder*="Weight"]').first()).toHaveValue('100')
    await expect(page.locator('.set-row input[placeholder*="Reps"]').first()).toHaveValue('5')
  })

  test('queues session to local outbox when network sync fails', async ({ page }) => {
    // Override PUT /api/sessions/* to return network failure / 500
    await page.route('**/api/sessions/**', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    await page.getByRole('button', { name: /Start Workout/i }).click()

    // Finish session while network is failing
    await page.getByRole('button', { name: 'Finish Workout' }).click()
    await expect(page.getByRole('heading', { name: 'Workout Complete!' })).toBeVisible()
    await page.getByRole('button', { name: 'Save and Finish' }).click()

    // Should indicate pending / offline in header badge
    await expect(page.locator('.status-badge')).toBeVisible()
    await expect(page.locator('header')).toContainText(/pending|Offline|queued/i)
  })

  test('persists catalogue in IndexedDB and allows offline exercise selection', async ({ page }) => {
    // Start workout while online to verify initial state
    await page.getByRole('button', { name: /Start Workout/i }).click()
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal.locator('.exercise-item', { hasText: 'Barbell Squat' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Now simulate offline / network failure for catalogue
    await page.route('**/api/exercises**', async (route) => {
      await route.abort('failed')
    })
    await page.route('**/api/routines**', async (route) => {
      await route.abort('failed')
    })

    // Reload page under offline conditions
    await page.reload()

    // Header should NOT show 'Failed to fetch catalogue' because IndexedDB has cached exercises
    await expect(page.locator('header')).not.toContainText('Failed to fetch catalogue')

    // Exercise picker should still open with cached exercises from IndexedDB
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    await expect(page.locator('.modal-overlay .exercise-item', { hasText: 'Barbell Squat' })).toBeVisible()
  })

  test('reports catalogue fetch failure to /api/client-errors when offline with empty cache', async ({ page }) => {
    let clientErrorCaptured = false
    let reportedPayload: Record<string, unknown> | null = null

    await page.route('**/api/client-errors**', async (route) => {
      if (route.request().method() === 'POST') {
        clientErrorCaptured = true
        reportedPayload = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        })
        return
      }
      await route.continue()
    })

    // Simulate network failure on initial load
    await page.route('**/api/exercises**', async (route) => {
      await route.abort('failed')
    })

    // Clear IndexedDB cache before navigating to ensure empty cache
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open('kratos')
        req.onsuccess = () => {
          const idb = req.result
          const names = Array.from(idb.objectStoreNames)
          if (!names.length) {
            idb.close()
            resolve()
            return
          }
          const tx = idb.transaction(names, 'readwrite')
          for (const name of names) {
            tx.objectStore(name).clear()
          }
          tx.oncomplete = () => {
            idb.close()
            resolve()
          }
          tx.onerror = () => {
            idb.close()
            resolve()
          }
        }
        req.onerror = () => resolve()
      })
    })

    await page.goto('/')

    // Should report error telemetry and show error status when no cache is available
    await expect(page.locator('header')).toContainText('Failed to fetch catalogue')
    expect(clientErrorCaptured).toBe(true)
    expect(reportedPayload).not.toBeNull()
    expect((reportedPayload as Record<string, unknown> | null)?.message).toBeTruthy()
  })
})
