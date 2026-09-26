import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  investments,
  mt5Deals,
  mt5Orders,
  mt5Positions,
  mt5SyncState,
} from '#/db/schema'
import { aggregateMt5PositionHistory } from '#/domain/mt5-history'
import { getSessionUser } from './session'
import { synchronizeMt5 } from './mt5-sync.service'

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

async function deskData() {
  const [positions, orders, deals, sync] = await Promise.all([
    getDb().select().from(mt5Positions).orderBy(desc(mt5Positions.openedAt)),
    getDb().select().from(mt5Orders).orderBy(desc(mt5Orders.placedAt)),
    getDb().select().from(mt5Deals).orderBy(desc(mt5Deals.executedAt)),
    getDb()
      .select()
      .from(mt5SyncState)
      .where(eq(mt5SyncState.id, 1))
      .limit(1)
      .then((rows) => rows.at(0) ?? null),
  ])
  const positionHistory = aggregateMt5PositionHistory(deals, positions)
  return {
    positions,
    orders,
    deals,
    positionHistory,
    completedPositions: positionHistory.filter(
      (position) => position.status === 'CLOSED',
    ),
    sync,
  }
}

export const getTradingDesk = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const [activeInvestment, desk] = await Promise.all([
      getDb()
        .select({ id: investments.id })
        .from(investments)
        .where(
          and(
            eq(investments.userId, user.id),
            eq(investments.status, 'ACTIVE'),
          ),
        )
        .then((rows) => rows.at(0)),
      deskData(),
    ])
    const canViewLive = Boolean(activeInvestment) || user.role === 'ADMIN'
    return {
      hasInvestment: Boolean(activeInvestment),
      canViewLive,
      positions: canViewLive ? desk.positions : [],
      orders: canViewLive ? desk.orders : [],
      openPositionHistory: canViewLive
        ? desk.positionHistory.filter(
            (position) => position.status !== 'CLOSED',
          )
        : [],
      completedPositions: desk.completedPositions,
      sync: desk.sync,
    }
  },
)

export const getAdminTradingDesk = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return deskData()
  },
)

export const synchronizeMt5Now = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requireAdmin()
    return synchronizeMt5()
  },
)
