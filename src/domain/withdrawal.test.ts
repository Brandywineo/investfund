import { describe, expect, it } from 'vitest'
import { calculateWithdrawal } from './withdrawal'

describe('withdrawal fees', () => {
  it('snapshots a five percent fee', () => {
    const result = calculateWithdrawal('50', '5')
    expect(result.gross.toFixed(2)).toBe('50.00')
    expect(result.fee.toFixed(2)).toBe('2.50')
    expect(result.net.toFixed(2)).toBe('47.50')
  })
})
