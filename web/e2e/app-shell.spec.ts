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
    await expect(page.getByTestId('refresh-button')).toBeVisible()
  })

  test('checks for PWA updates on visibilitychange and surfaces update banner', async ({ page }) => {
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

  test('flushes queued outbox before fetching sessions and clears caches on refresh click', async ({
    page,
  }) => {
    const queuedId1 = '99999999-9999-4999-8999-999999999901'
    const queuedId2 = '99999999-9999-4999-8999-999999999902'
    const requestOrder: string[] = []

    await expect(page.locator('.status-badge')).toContainText('All synced')

    page.on('request', (req) => {
      const url = new URL(req.url())
      if (req.method() === 'PUT' && url.pathname.startsWith('/api/sessions/')) {
        requestOrder.push(`PUT:${url.pathname}`)
      } else if (req.method() === 'GET' && url.pathname === '/api/sessions') {
        requestOrder.push(`GET:${url.pathname}`)
      }
    })

    await page.evaluate(async (sessionId) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('kratos')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('outbox', 'readwrite')
          tx.objectStore('outbox').put({
            id: sessionId,
            payload: {
              id: sessionId,
              routine_id: null,
              started_at: '2026-11-02T09:00:00.000Z',
              ended_at: '2026-11-02T09:45:00.000Z',
              notes: 'Offline session awaiting mount flush',
              extra: { routine_name: 'Queued Mount Workout' },
              items: [],
            },
            queuedAt: Date.now(),
            attempts: 0,
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    }, queuedId1)

    await page.reload()

    await expect.poll(() => requestOrder).toContain(`PUT:/api/sessions/${queuedId1}`)
    await expect.poll(() => requestOrder).toContain('GET:/api/sessions')
    const mountPutIdx = requestOrder.indexOf(`PUT:/api/sessions/${queuedId1}`)
    const mountGetIdx = requestOrder.indexOf('GET:/api/sessions')
    expect(mountPutIdx).toBeGreaterThanOrEqual(0)
    expect(mountGetIdx).toBeGreaterThan(mountPutIdx)

    await expect(page.locator('.status-badge')).toContainText('All synced')

    const remainingAfterMount = await page.evaluate(async () => {
      return await new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('kratos')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('outbox', 'readonly')
          const countReq = tx.objectStore('outbox').count()
          countReq.onsuccess = () => {
            db.close()
            resolve(countReq.result)
          }
          countReq.onerror = () => reject(countReq.error)
        }
      })
    })
    expect(remainingAfterMount).toBe(0)

    requestOrder.length = 0

    await page.evaluate(async (sessionId) => {
      if ('caches' in window && window.caches) {
        const cache = await window.caches.open('kratos-stale-cache-v1')
        await cache.put('/stale-bundle.js', new Response('stale'))
      }
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('kratos')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('outbox', 'readwrite')
          tx.objectStore('outbox').put({
            id: sessionId,
            payload: {
              id: sessionId,
              routine_id: null,
              started_at: '2026-11-02T09:30:00.000Z',
              ended_at: '2026-11-02T09:50:00.000Z',
              notes: 'Offline session awaiting manual refresh',
              extra: { routine_name: 'Queued Refresh Workout' },
              items: [],
            },
            queuedAt: Date.now(),
            attempts: 0,
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    }, queuedId2)

    const cachesBefore = await page.evaluate(async () =>
      'caches' in window && window.caches ? await window.caches.keys() : []
    )
    expect(cachesBefore).toContain('kratos-stale-cache-v1')

    await page.getByTestId('refresh-button').click()

    await expect
      .poll(async () =>
        page.evaluate(async () =>
          'caches' in window && window.caches ? await window.caches.keys() : []
        )
      )
      .toEqual([])

    await expect.poll(() => requestOrder).toContain(`PUT:/api/sessions/${queuedId2}`)
    await expect.poll(() => requestOrder).toContain('GET:/api/sessions')
    const refreshPutIdx = requestOrder.indexOf(`PUT:/api/sessions/${queuedId2}`)
    const refreshGetIdx = requestOrder.indexOf('GET:/api/sessions')
    expect(refreshPutIdx).toBeGreaterThanOrEqual(0)
    expect(refreshGetIdx).toBeGreaterThan(refreshPutIdx)
    await expect(page.locator('.status-badge')).toContainText('All synced')
  })
})
