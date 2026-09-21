import { describe, expect, it } from 'vitest'
import { accrualDateFromKey, businessDateKey } from './business-date'

describe('business dates', () => {
  it('uses the configured business timezone', () => {
    const nearMidnightUtc = new Date('2026-09-20T22:30:00.000Z')
    expect(businessDateKey(nearMidnightUtc, 'Africa/Nairobi')).toBe('2026-09-21')
    expect(businessDateKey(nearMidnightUtc, 'UTC')).toBe('2026-09-20')
  })

  it('normalizes a business day to a stable accrual timestamp', () => {
    expect(accrualDateFromKey('2026-09-21').toISOString()).toBe('2026-09-21T00:00:00.000Z')
  })
})
