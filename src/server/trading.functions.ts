import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { auditLogs, investments, tradingPositions } from '#/db/schema'
import { getSessionUser } from './session'

const optionalPrice = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !value || Number(value) > 0, 'Price must be positive')

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== 'ADMIN') throw new Error('Administrator access required')
  return user
}

export const getTradingDesk = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const [activeInvestment, open, closed] = await Promise.all([
      getDb()
        .select({ id: investments.id })
        .from(investments)
        .where(
          and(
            eq(investments.userId, user.id),
            eq(investments.status, 'ACTIVE'),
          ),
        )
        .then((rows) => rows.find((item) => item.id)),
      getDb()
        .select()
        .from(tradingPositions)
        .where(eq(tradingPositions.status, 'OPEN'))
        .orderBy(desc(tradingPositions.openedAt)),
      getDb()
        .select()
        .from(tradingPositions)
        .where(eq(tradingPositions.status, 'CLOSED'))
        .orderBy(desc(tradingPositions.closedAt))
        .limit(50),
    ])
    return { hasInvestment: Boolean(activeInvestment), open, closed }
  },
)

export const getAdminTradingDesk = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return getDb()
      .select()
      .from(tradingPositions)
      .orderBy(asc(tradingPositions.status), desc(tradingPositions.openedAt))
      .limit(200)
  },
)

export const createTradingPosition = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      symbol: z.string().trim().min(2).max(30),
      side: z.enum(['BUY', 'SELL']),
      entryPrice: z
        .string()
        .trim()
        .refine((value) => Number(value) > 0),
      currentPrice: optionalPrice,
      stopLoss: optionalPrice,
      takeProfit: optionalPrice,
      sizeLabel: z.string().trim().max(80),
      note: z.string().trim().max(500),
      openedAt: z.string().trim(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const position = await getDb()
      .insert(tradingPositions)
      .values({
        symbol: data.symbol.toUpperCase(),
        side: data.side,
        entryPrice: data.entryPrice,
        currentPrice: data.currentPrice || null,
        stopLoss: data.stopLoss || null,
        takeProfit: data.takeProfit || null,
        sizeLabel: data.sizeLabel || null,
        note: data.note || null,
        openedAt: data.openedAt ? new Date(data.openedAt) : new Date(),
        createdBy: admin.id,
      })
      .returning({ id: tradingPositions.id })
      .then((rows) => rows.at(0))
    if (!position) throw new Error('Position could not be created')
    await getDb().insert(auditLogs).values({
      actorUserId: admin.id,
      action: 'TRADING_POSITION_OPENED',
      entityType: 'trading_position',
      entityId: position.id,
      after: data,
    })
    return { success: true, positionId: position.id }
  })

export const updateTradingPosition = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      positionId: z.string().uuid(),
      action: z.enum(['UPDATE', 'CLOSE', 'CANCEL']),
      currentPrice: optionalPrice,
      pnlPercent: z.string().trim().max(30),
      note: z.string().trim().max(500),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const existing = await getDb()
      .select()
      .from(tradingPositions)
      .where(eq(tradingPositions.id, data.positionId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!existing || existing.status !== 'OPEN')
      throw new Error('Open position not found')
    const status =
      data.action === 'CLOSE'
        ? 'CLOSED'
        : data.action === 'CANCEL'
          ? 'CANCELLED'
          : 'OPEN'
    await getDb()
      .update(tradingPositions)
      .set({
        status,
        currentPrice: data.currentPrice || existing.currentPrice,
        pnlPercent:
          data.pnlPercent && Number.isFinite(Number(data.pnlPercent))
            ? data.pnlPercent
            : existing.pnlPercent,
        note: data.note || existing.note,
        closedAt: status === 'OPEN' ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tradingPositions.id, existing.id))
    await getDb()
      .insert(auditLogs)
      .values({
        actorUserId: admin.id,
        action: `TRADING_POSITION_${data.action}`,
        entityType: 'trading_position',
        entityId: existing.id,
        before: existing,
        after: {
          status,
          currentPrice: data.currentPrice,
          pnlPercent: data.pnlPercent,
          note: data.note,
        },
      })
    return { success: true }
  })
