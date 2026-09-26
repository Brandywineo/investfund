import { describe, expect, it } from 'vitest'
import { aggregateMt5PositionHistory, type HistoryDeal } from './mt5-history'

function deal(
  values: Partial<HistoryDeal> &
    Pick<HistoryDeal, 'ticket' | 'entry' | 'volume'>,
): HistoryDeal {
  return {
    positionTicket: 'position-1',
    symbol: 'XAUUSD.m',
    side: values.entry === 'IN' ? 'BUY' : 'SELL',
    price: '100',
    profit: '0',
    commission: '0',
    swap: '0',
    fee: '0',
    executedAt: new Date('2026-09-26T08:00:00Z'),
    ...values,
  }
}

describe('MT5 position history aggregation', () => {
  it('keeps a partial exit attached to the remaining live position', () => {
    const result = aggregateMt5PositionHistory(
      [
        deal({ ticket: '1', entry: 'IN', volume: '0.02', price: '100' }),
        deal({
          ticket: '2',
          entry: 'OUT',
          volume: '0.01',
          price: '110',
          profit: '10',
          commission: '-0.2',
          executedAt: new Date('2026-09-26T09:00:00Z'),
        }),
      ],
      [{ ticket: 'position-1', identifier: null, volume: '0.01' }],
    )

    expect(result[0]).toMatchObject({
      status: 'PARTIALLY_CLOSED',
      side: 'BUY',
      initialVolume: '0.02',
      closedVolume: '0.01',
      remainingVolume: '0.01',
      averageEntryPrice: '100',
      averageExitPrice: '110',
      realizedNetProfit: '9.8',
    })
    expect(result[0].exits).toHaveLength(1)
  })

  it('combines multiple exits into one closed position', () => {
    const result = aggregateMt5PositionHistory(
      [
        deal({ ticket: '1', entry: 'IN', volume: '0.02', price: '100' }),
        deal({
          ticket: '2',
          entry: 'OUT',
          volume: '0.01',
          price: '110',
          profit: '10',
        }),
        deal({
          ticket: '3',
          entry: 'OUT',
          volume: '0.01',
          price: '120',
          profit: '20',
        }),
      ],
      [],
    )

    expect(result[0]).toMatchObject({
      status: 'CLOSED',
      initialVolume: '0.02',
      closedVolume: '0.02',
      remainingVolume: '0',
      averageExitPrice: '115',
      realizedNetProfit: '30',
    })
    expect(result[0].exits).toHaveLength(2)
  })
})
