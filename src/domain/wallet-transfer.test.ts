import { describe, expect, it } from 'vitest'
import {
  ensureTransferBalance,
  validateWalletTransferRoute,
} from './wallet-transfer'

describe('controlled wallet transfer policy', () => {
  it('allows sweep gas BNB to move into the hot wallet', () => {
    expect(() =>
      validateWalletTransferRoute({
        sourceRole: 'SWEEP_GAS',
        destinationType: 'INTERNAL',
        destinationRole: 'HOT_WITHDRAWAL',
        asset: 'BNB',
      }),
    ).not.toThrow()
  })

  it('blocks arbitrary sweep-fee wallet destinations', () => {
    expect(() =>
      validateWalletTransferRoute({
        sourceRole: 'SWEEP_GAS',
        destinationType: 'EXTERNAL',
        asset: 'BNB',
      }),
    ).toThrow('only send BNB to the hot wallet')
  })

  it('reserves gas when calculating BNB spendability', () => {
    expect(() =>
      ensureTransferBalance({
        asset: 'BNB',
        amount: '0.00618',
        assetBalance: '0',
        nativeBalance: '0.006189',
        estimatedFeeBnb: '0.00001',
      }),
    ).toThrow('after reserving network gas')
  })

  it('requires BNB before a hot wallet can send USDT', () => {
    expect(() =>
      ensureTransferBalance({
        asset: 'USDT',
        amount: '10',
        assetBalance: '10.3',
        nativeBalance: '0',
        estimatedFeeBnb: '0.0001',
      }),
    ).toThrow('insufficient BNB')
  })
})
