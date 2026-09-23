import { and, eq, inArray, lt } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  mt5Deals,
  mt5Orders,
  mt5Positions,
  mt5SyncState,
  users,
} from '#/db/schema'
import { notifyUser } from './notification.service'
import { readMt5Bridge } from './mt5-bridge'

export async function synchronizeMt5() {
  const db = getDb()
  const startedAt = new Date()
  const state = await db
    .select()
    .from(mt5SyncState)
    .where(eq(mt5SyncState.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  await db
    .insert(mt5SyncState)
    .values({ id: 1, status: 'OFFLINE', lastSyncStartedAt: startedAt })
    .onConflictDoUpdate({
      target: mt5SyncState.id,
      set: { lastSyncStartedAt: startedAt, updatedAt: startedAt },
    })
  try {
    // Re-read a small overlap so deals around the cursor cannot be missed.
    const historyFrom = state?.lastHistoryCursorAt
      ? new Date(state.lastHistoryCursorAt.getTime() - 5 * 60_000)
      : null
    const { health, snapshot } = await readMt5Bridge(historyFrom)
    const positionTickets = snapshot.positions.map((item) => item.ticket)
    const existingTickets = positionTickets.length
      ? await db
          .select({ ticket: mt5Positions.ticket })
          .from(mt5Positions)
          .where(inArray(mt5Positions.ticket, positionTickets))
          .then((rows) => new Set(rows.map((row) => row.ticket)))
      : new Set<string>()

    await db.transaction(async (tx) => {
      for (const position of snapshot.positions) {
        await tx
          .insert(mt5Positions)
          .values({ ...position, lastSeenAt: startedAt })
          .onConflictDoUpdate({
            target: mt5Positions.ticket,
            set: {
              ...position,
              lastSeenAt: startedAt,
              updatedAt: startedAt,
            },
          })
      }
      await tx
        .delete(mt5Positions)
        .where(lt(mt5Positions.lastSeenAt, startedAt))

      for (const order of snapshot.orders) {
        await tx
          .insert(mt5Orders)
          .values({
            ...order,
            expiresAt: order.expiresAt ?? null,
            lastSeenAt: startedAt,
          })
          .onConflictDoUpdate({
            target: mt5Orders.ticket,
            set: {
              ...order,
              expiresAt: order.expiresAt ?? null,
              lastSeenAt: startedAt,
              updatedAt: startedAt,
            },
          })
      }
      await tx.delete(mt5Orders).where(lt(mt5Orders.lastSeenAt, startedAt))

      for (const deal of snapshot.deals) {
        await tx
          .insert(mt5Deals)
          .values({
            ...deal,
            orderTicket: deal.orderTicket ?? null,
            positionTicket: deal.positionTicket ?? null,
          })
          .onConflictDoNothing({ target: mt5Deals.ticket })
      }
      const newestDeal = snapshot.deals.reduce<Date | null>(
        (latest, deal) =>
          !latest || deal.executedAt > latest ? deal.executedAt : latest,
        state?.lastHistoryCursorAt ?? null,
      )
      await tx
        .insert(mt5SyncState)
        .values({
          id: 1,
          status: 'ONLINE',
          serverName: health.server ?? null,
          terminalVersion: health.terminalVersion ?? null,
          lastSyncStartedAt: startedAt,
          lastSuccessfulSyncAt: new Date(),
          lastHistoryCursorAt: newestDeal,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: mt5SyncState.id,
          set: {
            status: 'ONLINE',
            serverName: health.server ?? null,
            terminalVersion: health.terminalVersion ?? null,
            lastSuccessfulSyncAt: new Date(),
            lastHistoryCursorAt: newestDeal,
            lastError: null,
            updatedAt: new Date(),
          },
        })
    })

    const newPositions = snapshot.positions.filter(
      (position) => !existingTickets.has(position.ticket),
    )
    if (newPositions.length) {
      const recipients = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.status, 'ACTIVE')))
      await Promise.allSettled(
        newPositions.flatMap((position) =>
          recipients.map((recipient) =>
            notifyUser({
              userId: recipient.id,
              category: 'TRADING',
              title: `New ${position.side} position: ${position.symbol}`,
              body: `Entry ${position.entryPrice}. Open the trading desk for live position details.`,
              href: '/trading',
              eventKey: `mt5-position:${position.ticket}:opened`,
            }),
          ),
        ),
      )
    }
    return {
      positions: snapshot.positions.length,
      orders: snapshot.orders.length,
      dealsReceived: snapshot.deals.length,
      newPositions: newPositions.length,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await db
      .update(mt5SyncState)
      .set({ status: 'OFFLINE', lastError: message, updatedAt: new Date() })
      .where(eq(mt5SyncState.id, 1))
    throw cause
  }
}
