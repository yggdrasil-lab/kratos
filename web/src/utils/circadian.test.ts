import { describe, expect, it } from 'vitest'
import {
  formatSessionTimeRange,
  getCircadianDate,
  parseServerFasting,
  resolveFastingProtocol,
} from './circadian'

describe('getCircadianDate', () => {
  it('rolls over at 04:00 AM Pacific/Auckland rather than midnight', () => {
    // 2026-11-25 03:59 NZDT (UTC+13) == 2026-11-24 14:59:00Z -> still 2026-11-24
    expect(getCircadianDate(new Date('2026-11-24T14:59:00Z'))).toBe('2026-11-24')
    // 2026-11-25 04:00 NZDT (UTC+13) == 2026-11-24 15:00:00Z -> rolls over to 2026-11-25
    expect(getCircadianDate(new Date('2026-11-24T15:00:00Z'))).toBe('2026-11-25')
  })
})

describe('formatSessionTimeRange', () => {
  it('formats local timestamps and handles absent endedAt', () => {
    expect(formatSessionTimeRange('2026-11-25T11:30:00', '2026-11-25T12:25:00')).toBe(
      '11:30 AM - 12:25 PM'
    )
    expect(formatSessionTimeRange('2026-11-25T00:05:00', null)).toBe('12:05 AM')
    expect(formatSessionTimeRange(null, null)).toBe('')
  })
})

describe('parseServerFasting', () => {
  it('defaults target_window to canonical 14:10 when omitted in server payload', () => {
    const parsed = parseServerFasting({
      id: 'fb-1',
      date: '2026-11-25',
      feedback_type: 'fasting',
      rating: 'completed',
      payload: { energy: 'high' },
      notes: 'Clean fast',
      logged_at: '2026-11-25T10:35:00Z',
    })
    expect(parsed?.target_window).toBe('14:10')
    expect(parsed?.adherence).toBe('completed')
    expect(parsed?.energy).toBe('high')
  })

  it('returns undefined when fasting feedback or date is absent', () => {
    expect(parseServerFasting(null)).toBeUndefined()
    expect(parseServerFasting(undefined)).toBeUndefined()
  })
})

describe('resolveFastingProtocol', () => {
  it('uses canonical 14:10 baseline (10:30 AM - 8:30 PM) for both weekdays and weekends', () => {
    const weekday = resolveFastingProtocol(0, null) // Monday
    expect(weekday.protocolName).toBe('14:10 Circadian Protocol')
    expect(weekday.targetWindow).toBe('14:10')
    expect(weekday.windowHours).toBe('10:30 AM - 8:30 PM')
    expect(weekday.fuelingAnchors.some((a) => a.includes('10:30 AM'))).toBe(true)

    const weekend = resolveFastingProtocol(5, null) // Saturday
    expect(weekend.protocolName).toBe('14:10 Social Baseline')
    expect(weekend.targetWindow).toBe('14:10')
    expect(weekend.windowHours).toBe('10:30 AM - 8:30 PM')
  })

  it('preserves server recommendation and falls back to 14:10 when optional fields are nullish', () => {
    const resolved = resolveFastingProtocol(2, {
      date: '2026-11-25',
      protocol_name: '18:6 Metabolic Reset',
      target_window: '18:6',
      window_hours: '12:00 PM - 6:00 PM',
      rationale: 'Friday rest day with high HRV',
      fueling_anchors: ['12:00 PM: First meal', '05:30 PM: Dinner'],
      recovery_status: 'optimal',
      activity_context: 'Rest Day',
      is_llm_generated: true,
    })
    expect(resolved.protocolName).toBe('18:6 Metabolic Reset')
    expect(resolved.targetWindow).toBe('18:6')
    expect(resolved.isLlmGenerated).toBe(true)
  })
})
