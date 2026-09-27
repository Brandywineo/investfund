import { describe, expect, it } from 'vitest'
import { parseUnits } from 'ethers'
import { classifyDepositTransfer } from './deposit-transfer'

const classify = (amount: string) =>
  classifyDepositTransfer({
    rawValue: parseUnits(amount, 18),
    tokenDecimals: 18,
    minimumCreditedAmount: '0.10',
  })

describe('classifyDepositTransfer', () => {
  it('ignores zero-value address-poisoning events', () => {
    expect(classify('0')).toBe('ZERO_VALUE')
  })

  it.each(['0.0001', '0.0003', '0.09999999'])(
    'classifies %s USDT as dust',
    (amount) => expect(classify(amount)).toBe('DUST'),
  )

  it.each(['0.10', '300'])(
    'credits %s USDT at or above the threshold',
    (amount) => expect(classify(amount)).toBe('CREDIT'),
  )
})
