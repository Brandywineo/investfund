import { describe, expect, it } from 'vitest'
import {
  configuredRpcUrls,
  rpcFailureCategory,
  sanitizedRpcHostname,
} from './rpc-pool'

describe('RPC pool policy', () => {
  it('prefers the endpoint pool and removes duplicates', () => {
    expect(
      configuredRpcUrls({
        BSC_RPC_URL: 'https://legacy.example/key',
        BSC_RPC_URLS:
          'https://one.example/key, https://two.example/key\nhttps://one.example/key',
      }),
    ).toEqual(['https://one.example/key', 'https://two.example/key'])
  })

  it('falls back to the legacy endpoint', () => {
    expect(configuredRpcUrls({ BSC_RPC_URL: 'https://one.example/key' })).toEqual(
      ['https://one.example/key'],
    )
  })

  it('classifies failures that may safely fail over', () => {
    expect(rpcFailureCategory(new Error('HTTP 429 rate limit'))).toBe(
      'RATE_LIMIT',
    )
    expect(rpcFailureCategory(new Error('fetch failed'))).toBe('TRANSIENT')
    expect(rpcFailureCategory(new Error('invalid params'))).toBe('PERMANENT')
    expect(
      rpcFailureCategory({
        code: 'CALL_EXCEPTION',
        info: {
          error: {
            code: 429,
            message: 'Compute units per second capacity exceeded',
          },
        },
      }),
    ).toBe('RATE_LIMIT')
  })

  it('never exposes endpoint paths as the display name', () => {
    expect(sanitizedRpcHostname('https://one.example/private-key')).toBe(
      'one.example',
    )
  })
})
