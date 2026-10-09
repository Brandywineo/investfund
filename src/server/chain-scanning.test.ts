import { afterEach, expect, it, vi } from 'vitest'
import type { RpcPool } from './rpc-pool'
import { chunkedLogs, nativeTransfers } from './chain-worker.service'

afterEach(() => vi.unstubAllGlobals())
it('splits rejected log ranges and includes every block exactly once', async () => {
  const accepted: number[] = []
  let rejected = 0
  const pool = {
    run: async (operation: (endpoint: unknown) => Promise<unknown>) =>
      operation({
        provider: {
          getLogs: async ({
            fromBlock,
            toBlock,
          }: {
            fromBlock: number
            toBlock: number
          }) => {
            if (toBlock - fromBlock > 9) {
              rejected += 1
              throw new Error('block range limited to 10 blocks')
            }
            const blocks = Array.from(
              { length: toBlock - fromBlock + 1 },
              (_, index) => fromBlock + index,
            )
            accepted.push(...blocks)
            return blocks.map((blockNumber) => ({ blockNumber }))
          },
        },
      }),
  } as unknown as RpcPool
  const logs = await chunkedLogs({
    rpcPool: pool,
    filter: {},
    fromBlock: 101,
    toBlock: 200,
    chunkBlocks: 100,
    concurrency: 4,
  })
  expect(logs.map((log) => log.blockNumber)).toEqual(
    Array.from({ length: 100 }, (_, index) => 101 + index),
  )
  expect(new Set(accepted).size).toBe(100)
  expect(accepted).toHaveLength(100)
  const previousRejected = rejected
  const later = await chunkedLogs({
    rpcPool: pool,
    filter: {},
    fromBlock: 201,
    toBlock: 300,
    chunkBlocks: 100,
    concurrency: 4,
  })
  expect(rejected).toBe(previousRejected)
  expect(later.map((log) => log.blockNumber)).toEqual(
    Array.from({ length: 100 }, (_, index) => 201 + index),
  )
})
it('rejects an incomplete native RPC batch instead of treating it as fully scanned', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => [{ result: { number: '0x65', transactions: [] } }],
    })),
  )
  const pool = {
    run: async (operation: (endpoint: unknown) => Promise<unknown>) =>
      operation({ url: 'https://rpc.invalid' }),
  } as unknown as RpcPool
  await expect(nativeTransfers(pool, 101, 102, 1)).rejects.toThrow(
    'incomplete blocks',
  )
})
