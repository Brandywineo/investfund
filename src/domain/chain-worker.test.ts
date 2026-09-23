import { describe, expect, it } from 'vitest'
import {
  chainWorkerHealth,
  hasSufficientHotGas,
  scannerBlockRanges,
} from './chain-worker'

describe('chain worker policy', () => {
  it('splits a logical batch into provider-safe inclusive ranges', () => {
    expect(scannerBlockRanges(101, 125, 10)).toEqual([
      { fromBlock: 101, toBlock: 110 },
      { fromBlock: 111, toBlock: 120 },
      { fromBlock: 121, toBlock: 125 },
    ])
  })

  it('reports backlog health without allowing a negative lag', () => {
    expect(chainWorkerHealth(100, 80)).toEqual({
      blockLag: 0,
      status: 'HEALTHY',
    })
    expect(chainWorkerHealth(100, 250).status).toBe('CATCHING_UP')
    expect(chainWorkerHealth(100, 1_500).status).toBe('CRITICAL')
  })

  it('requires the configured confirmed BNB reserve', () => {
    expect(hasSufficientHotGas('0.00002', '0.00002')).toBe(true)
    expect(hasSufficientHotGas('0.000019', '0.00002')).toBe(false)
  })
})
