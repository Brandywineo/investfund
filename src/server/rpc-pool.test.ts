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

    try {
      const result = await pool.run(({ index }) => {
        attempted.push(index)
        if (index === 0) return new Promise<string>(() => undefined)
        return Promise.resolve('healthy')
      })

      expect(result).toBe('healthy')
      expect(attempted).toEqual([0, 1])
      expect(pool.snapshot().failovers).toBe(1)
    } finally {
      pool.destroy()
    }
  })

  it('shares successful requests fairly across configured endpoints', async () => {
    const pool = new RpcPool({
      chainId: 56,
      urls: [
        'https://rpc-one.invalid',
        'https://rpc-two.invalid',
        'https://rpc-three.invalid',
      ],
    })
    const selected: Array<number> = []

    try {
      for (let request = 0; request < 6; request += 1)
        await pool.run(async ({ index }) => {
          selected.push(index)
          return index
        })

      expect(selected).toEqual([0, 1, 2, 0, 1, 2])
      expect(pool.snapshot().failovers).toBe(0)
    } finally {
      pool.destroy()
    }
  })
})
