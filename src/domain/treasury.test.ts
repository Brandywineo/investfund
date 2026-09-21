import { describe, expect, it } from 'vitest'
import { availableTreasuryLiquidity, reserveRequirement } from './treasury'

describe('treasury reserve calculations', () => {
  it('uses the higher of the fixed and percentage reserve', () => {
    expect(reserveRequirement('10000', '500', '10').toFixed(2)).toBe('1000.00')
    expect(reserveRequirement('1000', '500', '10').toFixed(2)).toBe('500.00')
  })

  it('excludes approved withdrawals and the reserve from transferable liquidity', () => {
    expect(availableTreasuryLiquidity('5000', '700', '1000').toFixed(2)).toBe(
      '3300.00',
    )
    expect(availableTreasuryLiquidity('500', '700', '1000').toFixed(2)).toBe(
      '0.00',
    )
  })
})
