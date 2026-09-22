import { describe, expect, it } from 'vitest'
import {
  accrualIdempotencyKey,
  calculateDailyAccrual,
  validateInvestmentAmount,
} from './accrual'

describe('daily accrual', () => {
  it('compounds 1,000 USDT at 2% for two daily postings', () => {
    const dayOne = calculateDailyAccrual('1000', '2')
    const dayTwo = calculateDailyAccrual(dayOne.closingBalance, '2')

    expect(dayOne.amount.toFixed(2)).toBe('20.00')
    expect(dayOne.closingBalance.toFixed(2)).toBe('1020.00')
    expect(dayTwo.amount.toFixed(2)).toBe('20.40')
    expect(dayTwo.closingBalance.toFixed(2)).toBe('1040.40')
  })

  it('enforces the configured minimum and maximum', () => {
    expect(validateInvestmentAmount('300', '300', '5000').toFixed(2)).toBe(
      '300.00',
    )
    expect(validateInvestmentAmount('5000', '300', '5000').toFixed(2)).toBe(
      '5000.00',
    )
    expect(() => validateInvestmentAmount('299.99', '300', '5000')).toThrow()
    expect(() => validateInvestmentAmount('5000.01', '300', '5000')).toThrow()
  })

  it('builds a stable daily idempotency key', () => {
    expect(accrualIdempotencyKey('investment-1', '2026-09-21T23:45:00Z')).toBe(
      'daily-accrual:investment-1:2026-09-21',
    )
  })
})
