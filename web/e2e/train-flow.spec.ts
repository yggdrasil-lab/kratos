import { test, expect } from '@playwright/test'
import { setupMockApi } from './helpers/mock-data'

test.describe('Train Flow and Effort Debrief', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page)
    await page.goto('/')
  })

  test('starts workout from Today, logs sets, debriefs effort, and saves session', async ({ page }) => {
    // Today view has the staged workout button
    const startBtn = page.getByRole('button', { name: /Start Workout/i })
    await expect(startBtn).toBeVisible()
    await startBtn.click()

    // Current workout view
    await expect(page.getByRole('heading', { name: /Upper Body A|Current Workout/i })).toBeVisible()

    // Add another exercise
    await page.getByRole('button', { name: '+ Add Exercise' }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    // Search and select Barbell Squat
    const searchInput = modal.locator('input[placeholder="Search exercises..."]')
    await searchInput.fill('Squat')
    const exerciseItem = modal.locator('.exercise-item', { hasText: 'Barbell Squat' })
    await expect(exerciseItem).toBeVisible()
    await exerciseItem.click()
    await expect(modal).not.toBeVisible()

    // Exercise added to workout
    await expect(page.locator('.workout-item h3', { hasText: 'Barbell Squat' })).toBeVisible()

    // Fill in set
    const weightInputs = page.locator('.set-row input[placeholder*="Weight"]')
    const repsInputs = page.locator('.set-row input[placeholder*="Reps"]')
    await weightInputs.first().fill('32.5')
    await repsInputs.first().fill('10')

    // Finish workout - opens Effort Debrief Modal
    const finishBtn = page.getByRole('button', { name: 'Finish Workout' })
    await finishBtn.click()

    // Verify Effort Debrief Modal appears
    await expect(page.getByRole('heading', { name: 'Workout Complete!' })).toBeVisible()
    await expect(page.getByText('How much effort did this take?')).toBeVisible()

    // Select Optimal effort
    const optimalBtn = page.getByRole('button', { name: /Just Right \/ Optimal/i })
    await expect(optimalBtn).toBeVisible()
    await optimalBtn.click()

    // Select quick tag
    const feltStrongTag = page.getByRole('button', { name: '💪 Felt Strong' })
    await expect(feltStrongTag).toBeVisible()
    await feltStrongTag.click()

    // Complete and save
    const saveBtn = page.getByRole('button', { name: 'Save and Finish' })
    await saveBtn.click()

    // Modal closes and returns to Today view
    await expect(page.getByRole('heading', { name: 'Workout Complete!' })).not.toBeVisible()
    await expect(page.getByText(/Today's Training/i)).toBeVisible()
  })

  test('renders smart workout autoregulation badge, readiness adaptation, and research grounding', async ({ page }) => {
    // 1. Verify AI badge and readiness adaptation banner
    await expect(page.getByText('⚡ AI Autoregulated')).toBeVisible()
    await expect(page.getByText('Progressive Overload', { exact: true })).toBeVisible()
    await expect(page.getByText(/MAV • RPE 8-9 \(1-2 RIR\)/i)).toBeVisible()

    // 2. Verify exercise cues and per-hand weight basis indicator
    await expect(page.getByText(/15kg per hand/i)).toBeVisible()
    await expect(page.getByText(/Progressive overload anchor: push to 1 RIR on set 3/i)).toBeVisible()

    // 3. Verify research citation accordion
    const citationBtn = page.getByRole('button', { name: /Israetel \(Volume Landmarks\) & Helms \(Autoregulation RIR\)/i })
    await expect(citationBtn).toBeVisible()
    await citationBtn.click()

    // 4. Verify expanded scientific pillars
    await expect(page.getByText(/Israetel \(RP\): Sets scaled between MEV/i)).toBeVisible()
    await expect(page.getByText(/Concurrent Interference: Preserves leg power/i)).toBeVisible()
  })

  test('adapts workout protocol with AI modal and custom context', async ({ page }) => {
    // Locate and click the workout Adapt button
    const adaptBtn = page.getByTitle('Autoregulate training with AI sports physiology')
    await expect(adaptBtn).toBeVisible()
    await adaptBtn.click()

    // Modal opens
    const modal = page.locator('.modal-backdrop')
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('heading', { name: 'Adaptive Workout Synthesizer' })).toBeVisible()

    // Verify 4 scientific pillars in modal
    await expect(modal.getByText(/Volume Landmarks \(RP\):/i)).toBeVisible()
    await expect(modal.getByText(/RIR Autoregulation:/i)).toBeVisible()
    await expect(modal.getByText(/Joint Sparing \(McGill\):/i)).toBeVisible()
    await expect(modal.getByText(/Court Freshness:/i)).toBeVisible()

    // Type custom context and submit
    const textarea = modal.locator('textarea')
    await textarea.fill('Left shoulder pinching, need quick 35m session')
    await modal.getByRole('button', { name: /Synthesize Training/i }).click()

    // Modal closes and updated workout is displayed
    await expect(modal).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Upper Body A (Joint-Sparing Autoregulated)' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Start Workout \(Upper Body A \(Joint-Sparing Autoregulated\)\)/i })).toBeVisible()
    await expect(page.getByText(/Fatigue \/ Joint Deload/i)).toBeVisible()
    await expect(page.getByText(/MEV • RPE 7-8 \(2 RIR\)/i)).toBeVisible()
    await expect(page.getByText(/Neutral grip; elbows tucked 45 deg/i)).toBeVisible()

    // 5. Start workout with the adapted recommendation and verify exercises are populated
    await page.getByRole('button', { name: /Start Workout/i }).click()
    await expect(page.getByRole('heading', { name: /Upper Body A \(Joint-Sparing Autoregulated\)/i })).toBeVisible()
    await expect(page.locator('.workout-item h3', { hasText: 'Bench Press (Dumbbell)' })).toBeVisible()
    await expect(page.getByText('KG / HAND')).toBeVisible()
  })

  test('sport and rest days do not leak resistance routines and display fueling and recovery details', async ({ page }) => {
    // Override workout recommendation to a sport session (Badminton with empty exercises)
    await page.route(/\/api\/biometrics\/workout-recommendation(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: '2026-11-01',
          routine_name: 'Badminton Match Play',
          rationale: 'High-intensity intervals require glycogen and central nervous sharpness for Badminton.',
          target_rir: 'RIR 2-3',
          recovery_status: 'optimal',
          volume_landmark: 'Sport Fueling',
          readiness_adaptation: 'Sport activity scheduled. Preserve musculoskeletal freshness and prioritize mobility.',
          exercises: [],
          is_llm_generated: false,
        }),
      })
    })

    await page.goto('/')

    // 1. Verify sport headline and subtitle
    await expect(page.getByRole('heading', { name: 'Badminton Match Play' })).toBeVisible()
    await expect(page.getByText(/Sport Fueling • Match play & anaerobic preservation/i)).toBeVisible()

    // 2. Verify sport protocol details card is shown
    await expect(page.getByText('Badminton Match Play • Fueling & Readiness')).toBeVisible()
    await expect(page.getByText(/No resistance lifting scheduled today/i)).toBeVisible()
    await expect(page.getByText('⚡ Court Readiness')).toBeVisible()
    await expect(page.getByText('🍌 Glycogen & Fueling')).toBeVisible()

    // 3. Verify resistance exercises from routines[] are NOT leaked in preview
    await expect(page.getByText('2 sets to failure')).not.toBeVisible()

    // 4. Verify Start Workout button is NOT wired to launch resistance routine
    await expect(page.getByRole('button', { name: /Start Workout/i })).not.toBeVisible()
    await expect(page.getByText(/Sport day in effect. To log an unscheduled lifting session instead/i)).toBeVisible()

    // 5. Test Swap Split override: user explicitly picks a split
    await page.getByRole('button', { name: 'Swap Split' }).click()
    await page.getByRole('button', { name: 'Upper Body A' }).click()

    // Now Upper Body A is active
    await expect(page.getByRole('heading', { name: 'Upper Body A' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Start Workout \(Upper Body A\)/i })).toBeVisible()

    // 6. Test Reset to Scheduled
    await page.getByRole('button', { name: 'Swap Split' }).click()
    await page.getByRole('button', { name: /Reset to Scheduled/i }).click()
    await expect(page.getByRole('heading', { name: 'Badminton Match Play' })).toBeVisible()
    await expect(page.getByText('Badminton Match Play • Fueling & Readiness')).toBeVisible()
  })
})
