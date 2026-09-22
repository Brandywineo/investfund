import { describe, expect, it } from 'vitest'
import { referralCommission } from './referral'

describe('referral commissions', () => {
  it('pays 1%, 0.5%, and 0.24% of posted profit', () => {
    expect(referralCommission('6', 1).toFixed(8)).toBe('0.06000000')
    expect(referralCommission('6', 2).toFixed(8)).toBe('0.03000000')
    expect(referralCommission('6', 3).toFixed(8)).toBe('0.01440000')
  })
})
