import { z } from 'zod'

const decimal = z.union([z.string(), z.number()]).transform(String)
const nullableDecimal = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) =>
    value === null || value === undefined ? null : String(value),
  )
const instant = z
  .union([z.string(), z.number()])
  .transform((value, context) => {
    const date =
      typeof value === 'number'
        ? new Date(value > 10_000_000_000 ? value : value * 1_000)
        : new Date(value)
    if (Number.isNaN(date.getTime())) {
      context.addIssue({ code: 'custom', message: 'Invalid MT5 timestamp' })
      return z.NEVER
    }
    return date
  })

export const mt5HealthPayload = z.object({
  connected: z.boolean(),
  server: z.string().trim().min(1).max(200).nullable().optional(),
  terminalVersion: z.string().trim().max(100).nullable().optional(),
})

export const mt5PositionPayload = z.object({
  ticket: z.union([z.string(), z.number()]).transform(String),
  identifier: z
    .union([z.string(), z.number()])
    .transform(String)
    .nullable()
    .optional(),
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(['BUY', 'SELL']),
  volume: decimal,
  entryPrice: decimal,
  currentPrice: nullableDecimal,
  stopLoss: nullableDecimal,
  takeProfit: nullableDecimal,
  floatingProfit: nullableDecimal,
  swap: nullableDecimal,
  openedAt: instant,
})

export const mt5OrderPayload = z.object({
  ticket: z.union([z.string(), z.number()]).transform(String),
  symbol: z.string().trim().min(1).max(40),
  orderType: z.string().trim().min(1).max(60),
  volumeInitial: decimal,
  volumeCurrent: decimal,
  requestedPrice: nullableDecimal,
  stopLoss: nullableDecimal,
  takeProfit: nullableDecimal,
  placedAt: instant,
  expiresAt: instant.nullable().optional(),
})

export const mt5DealPayload = z.object({
  ticket: z.union([z.string(), z.number()]).transform(String),
  orderTicket: z
    .union([z.string(), z.number()])
    .transform(String)
    .nullable()
    .optional(),
  positionTicket: z
    .union([z.string(), z.number()])
    .transform(String)
    .nullable()
    .optional(),
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(['BUY', 'SELL']),
  entry: z.string().trim().min(1).max(40),
  volume: decimal,
  price: decimal,
  profit: decimal,
  commission: decimal,
  swap: decimal,
  fee: decimal,
  executedAt: instant,
})

export const mt5SnapshotPayload = z.object({
  positions: z.array(mt5PositionPayload),
  orders: z.array(mt5OrderPayload),
  deals: z.array(mt5DealPayload),
})

export type Mt5Snapshot = z.infer<typeof mt5SnapshotPayload>
