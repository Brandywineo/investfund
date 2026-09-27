import { describe, expect, it } from 'vitest'
import { RpcPool } from './rpc-pool'

describe('RPC pool request deadlines', () => {
  it('fails over when an endpoint never returns', async () => {
    const pool = new RpcPool({
      chainId: 56,
      urls: ['https://rpc-one.invalid', 'https://rpc-two.invalid'],
      cooldownMs: 1_000,
      requestTimeoutMs: 1_000,
    })
    const attempted: Array<number> = []

    const result = await pool.run(({ index }) => {
      attempted.push(index)
      if (index === 0) return new Promise<string>(() => undefined)
      return Promise.resolve('healthy')
    })

    expect(result).toBe('healthy')
    expect(attempted).toEqual([0, 1])
    expect(pool.snapshot().failovers).toBe(1)
  })
})
