import { describe, expect, it, vi } from 'vitest'
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
      expect(pool.diagnosticSnapshot().requests[0].category).toBe('TIMEOUT')
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

it('records failures by method and endpoint without storing credential-bearing URLs or error messages', async () => {
  const pool = new RpcPool({
    chainId: 56,
    urls: [
      'https://rpc-one.invalid/v2/SECRET?token=PRIVATE',
      'https://rpc-two.invalid/v2/OTHER',
    ],
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    await pool.run(
      async ({ index }) => {
        if (index === 0)
          throw Object.assign(
            new Error('429 https://rpc-one.invalid/v2/SECRET'),
            { status: 429 },
          )
        return 'ok'
      },
      { method: 'eth_getLogs' },
    )
    const diagnostics = pool.diagnosticSnapshot()
    expect(
      diagnostics.requests.map((row) => [
        row.endpoint,
        row.method,
        row.category,
        row.count,
      ]),
    ).toEqual([
      [1, 'eth_getLogs', 'RATE_LIMIT', 1],
      [2, 'eth_getLogs', 'SUCCESS', 1],
    ])
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /SECRET|PRIVATE|OTHER|https:/,
    )
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /SECRET|PRIVATE|OTHER|https:/,
    )
  } finally {
    pool.destroy()
    warning.mockRestore()
  }
})

it('distinguishes adaptive query limits from ordinary permanent errors', async () => {
  const pool = new RpcPool({
    chainId: 56,
    urls: ['https://rpc.invalid/v2/SECRET'],
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    await expect(
      pool.run(
        async () => {
          throw new Error('LOG_RANGE_LIMIT')
        },
        { method: 'eth_getLogs' },
      ),
    ).rejects.toThrow('LOG_RANGE_LIMIT')
    expect(pool.diagnosticSnapshot().requests[0].category).toBe('QUERY_LIMIT')
  } finally {
    pool.destroy()
    warning.mockRestore()
  }
})
