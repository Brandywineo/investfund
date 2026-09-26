import Decimal from 'decimal.js'

export type HistoryDeal = {
  ticket: string
  positionTicket: string | null
  symbol: string
  side: string
  entry: string
  volume: string
  price: string
  profit: string
  commission: string
  swap: string
  fee: string
  executedAt: Date
}

export type LivePosition = {
  ticket: string
  identifier: string | null
  volume: string
}

export type PositionExit = {
  ticket: string
  volume: string
  price: string
  netProfit: string
  executedAt: Date
}

export type PositionHistory = {
  positionTicket: string
  symbol: string
  side: 'BUY' | 'SELL'
  status: 'OPEN' | 'PARTIALLY_CLOSED' | 'CLOSED'
  initialVolume: string
  closedVolume: string
  remainingVolume: string
  averageEntryPrice: string | null
  averageExitPrice: string | null
  realizedNetProfit: string
  openedAt: Date
  closedAt: Date | null
  exits: PositionExit[]
}

const openingEntries = new Set(['IN'])
const closingEntries = new Set(['OUT', 'OUT_BY', 'INOUT'])

function decimal(value: string | null | undefined) {
  return new Decimal(value || 0)
}

function averagePrice(deals: HistoryDeal[], acceptedEntries: Set<string>) {
  const accepted = deals.filter((deal) => acceptedEntries.has(deal.entry))
  const volume = accepted.reduce(
    (total, deal) => total.add(deal.volume),
    new Decimal(0),
  )
  if (volume.isZero()) return null
  return accepted
    .reduce(
      (total, deal) => total.add(decimal(deal.price).mul(deal.volume)),
      new Decimal(0),
    )
    .div(volume)
    .toString()
}

export function aggregateMt5PositionHistory(
  deals: HistoryDeal[],
  livePositions: LivePosition[],
): PositionHistory[] {
  const liveByTicket = new Map<string, LivePosition>()
  for (const position of livePositions) {
    liveByTicket.set(position.ticket, position)
    if (position.identifier) liveByTicket.set(position.identifier, position)
  }

  const groups = new Map<string, HistoryDeal[]>()
  for (const deal of deals) {
    const key = deal.positionTicket || `deal:${deal.ticket}`
    const group = groups.get(key) ?? []
    group.push(deal)
    groups.set(key, group)
  }

  return [...groups.entries()]
    .map(([positionTicket, positionDeals]) => {
      const ordered = [...positionDeals].sort(
        (left, right) => left.executedAt.getTime() - right.executedAt.getTime(),
      )
      const openings = ordered.filter((deal) => openingEntries.has(deal.entry))
      const closings = ordered.filter((deal) => closingEntries.has(deal.entry))
      const live = liveByTicket.get(positionTicket)
      const openedVolume = openings.reduce(
        (total, deal) => total.add(deal.volume),
        new Decimal(0),
      )
      const closedVolume = closings.reduce(
        (total, deal) => total.add(deal.volume),
        new Decimal(0),
      )
      const remainingVolume = live
        ? decimal(live.volume)
        : Decimal.max(openedVolume.sub(closedVolume), 0)
      const initialVolume = Decimal.max(
        openedVolume,
        closedVolume.add(remainingVolume),
      )
      const realizedNetProfit = ordered.reduce(
        (total, deal) =>
          total
            .add(deal.profit)
            .add(deal.commission)
            .add(deal.swap)
            .add(deal.fee),
        new Decimal(0),
      )
      const firstOpening = openings.at(0) ?? ordered[0]
      const lastClosing = closings.at(-1)
      const status = live
        ? closedVolume.gt(0)
          ? 'PARTIALLY_CLOSED'
          : 'OPEN'
        : 'CLOSED'
      return {
        positionTicket,
        symbol: firstOpening.symbol,
        side: firstOpening.side as 'BUY' | 'SELL',
        status,
        initialVolume: initialVolume.toString(),
        closedVolume: closedVolume.toString(),
        remainingVolume: remainingVolume.toString(),
        averageEntryPrice: averagePrice(ordered, openingEntries),
        averageExitPrice: averagePrice(ordered, closingEntries),
        realizedNetProfit: realizedNetProfit.toString(),
        openedAt: firstOpening.executedAt,
        closedAt: live
          ? null
          : (lastClosing?.executedAt ?? ordered.at(-1)!.executedAt),
        exits: closings.map((deal) => ({
          ticket: deal.ticket,
          volume: deal.volume,
          price: deal.price,
          netProfit: decimal(deal.profit)
            .add(deal.commission)
            .add(deal.swap)
            .add(deal.fee)
            .toString(),
          executedAt: deal.executedAt,
        })),
      } satisfies PositionHistory
    })
    .sort((left, right) => {
      const leftDate = left.closedAt ?? left.openedAt
      const rightDate = right.closedAt ?? right.openedAt
      return rightDate.getTime() - leftDate.getTime()
    })
}
