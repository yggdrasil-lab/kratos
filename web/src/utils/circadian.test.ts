import { describe, expect, it } from 'vitest'
import { formatSessionTimeRange, getCircadianDate } from './circadian'

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
