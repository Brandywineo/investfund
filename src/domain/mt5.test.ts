import { describe, expect, it } from 'vitest'
import { mt5SnapshotPayload } from './mt5'

describe('MT5 read-only payload', () => {
  it('accepts positions, orders and deals without account financials', () => {
    const result = mt5SnapshotPayload.parse({
      positions: [
        {
          ticket: 101,
          symbol: 'XAUUSD',
          side: 'BUY',
          volume: 0.1,
          entryPrice: 2400.5,
          currentPrice: 2402,
          openedAt: 1_795_000_000,
        },
      ],
      orders: [],
      deals: [
        {
          ticket: '201',
          symbol: 'XAUUSD',
          side: 'SELL',
          entry: 'OUT',
          volume: '0.1',
          price: '2405',
          profit: '45',
          commission: '-1',
          swap: '0',
          fee: '0',
          executedAt: '2026-09-23T10:00:00Z',
        },
      ],
    })
    expect(result.positions[0].ticket).toBe('101')
    expect(result.positions[0].openedAt).toBeInstanceOf(Date)
    expect(result.deals[0].profit).toBe('45')
  })

  it('rejects invalid trade directions', () => {
    expect(() =>
      mt5SnapshotPayload.parse({
        positions: [
          {
            ticket: '1',
            symbol: 'EURUSD',
            side: 'HOLD',
            volume: '1',
            entryPrice: '1.2',
            openedAt: '2026-09-23T10:00:00Z',
          },
        ],
        orders: [],
        deals: [],
      }),
    ).toThrow()
  })
})
