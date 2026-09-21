import { describe, expect, it } from 'vitest'
import { assertBalanced } from './ledger'

describe('ledger invariants', () => {
  it('accepts a balanced transaction', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'cash', side: 'DEBIT', amount: '1000' },
        { accountId: 'user-liability', side: 'CREDIT', amount: '1000' },
      ]),
    ).not.toThrow()
  })

  it('rejects an unbalanced transaction', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'cash', side: 'DEBIT', amount: '1000' },
        { accountId: 'user-liability', side: 'CREDIT', amount: '999' },
      ]),
    ).toThrow(/unbalanced/)
  })
})
