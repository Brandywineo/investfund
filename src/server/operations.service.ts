import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  chainWatcherState,
  chainWorkerRuns,
  mt5SyncState,
  operationalEvents,
  users,
} from '#/db/schema'
import { notifyUser } from './notification.service'

export type HealthSignal = {
  key: string
  unhealthy: boolean
  component: string
  severity: 'WARNING' | 'CRITICAL'
  title: string
  message: string
  metadata?: Record<string, unknown>
}

async function applySignal(signal: HealthSignal) {
  const db = getDb()
  const existing = await db
    .select()
    .from(operationalEvents)
    .where(eq(operationalEvents.eventKey, signal.key))
    .limit(1)
    .then((rows) => rows.at(0))
  const now = new Date()

  if (!signal.unhealthy) {
    if (existing?.status === 'OPEN')
      await db
        .update(operationalEvents)
        .set({ status: 'RESOLVED', resolvedAt: now, updatedAt: now })
        .where(eq(operationalEvents.id, existing.id))
    return
  }

  const newlyOpened = !existing || existing.status === 'RESOLVED'
  const openedAt = newlyOpened ? now : existing.openedAt
  const event = await db
    .insert(operationalEvents)
    .values({
      eventKey: signal.key,
      component: signal.component,
      severity: signal.severity,
      title: signal.title,
      message: signal.message,
      metadata: signal.metadata,
      openedAt,
      lastObservedAt: now,
    })
    .onConflictDoUpdate({
      target: operationalEvents.eventKey,
      set: {
        component: signal.component,
        severity: signal.severity,
        status: 'OPEN',
        title: signal.title,
        message: signal.message,
        metadata: signal.metadata,
        openedAt,
        lastObservedAt: now,
        resolvedAt: null,
        updatedAt: now,
      },
    })
    .returning({
      id: operationalEvents.id,
      openedAt: operationalEvents.openedAt,
    })
    .then((rows) => rows.at(0))

  if (!newlyOpened || !event) return
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')))
  await Promise.allSettled(
    admins.map((admin) =>
      notifyUser({
        userId: admin.id,
        category: 'SYSTEM',
        title: signal.title,
        body: signal.message,
        href: '/admin/operations',
        eventKey: `operations:${signal.key}:${event.openedAt.toISOString()}`,
      }),
    ),
  )
}

export async function evaluateOperationalHealth() {
  const db = getDb()
  const [chain, mt5, lastRun] = await Promise.all([
    db
      .select()
      .from(chainWatcherState)
      .where(eq(chainWatcherState.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select()
      .from(mt5SyncState)
      .where(eq(mt5SyncState.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select()
      .from(chainWorkerRuns)
      .orderBy(desc(chainWorkerRuns.finishedAt))
      .limit(1)
      .then((rows) => rows.at(0)),
  ])
  const now = Date.now()
  const lag = Math.max(
    0,
    Number(chain?.lastHeadBlock ?? 0) - Number(chain?.lastScannedBlock ?? 0),
  )
  const chainAgeMs = chain?.lastRunAt
    ? now - chain.lastRunAt.getTime()
    : Number.MAX_SAFE_INTEGER
  const mt5AgeMs = mt5?.lastSuccessfulSyncAt
    ? now - mt5.lastSuccessfulSyncAt.getTime()
    : Number.MAX_SAFE_INTEGER
  const signals: Array<HealthSignal> = [
    {
      key: 'chain:last-run-failed',
      unhealthy: lastRun?.status === 'FAILED',
      component: 'CHAIN',
      severity: 'CRITICAL',
      title: 'Chain worker run failed',
      message: lastRun?.error || 'The latest BSC worker run failed.',
      metadata: { runId: lastRun?.id ?? null },
    },
    {
      key: 'chain:lag',
      unhealthy: lag > 100,
      component: 'CHAIN',
      severity: lag > 1_000 ? 'CRITICAL' : 'WARNING',
      title:
        lag > 1_000
          ? 'Chain scanner critically behind'
          : 'Chain scanner delayed',
      message: `The BSC scanner is ${lag.toLocaleString()} blocks behind.`,
      metadata: {
        lag,
        head: chain?.lastHeadBlock,
        scanned: chain?.lastScannedBlock,
      },
    },
    {
      key: 'chain:stale',
      unhealthy: chainAgeMs > 2 * 60_000,
      component: 'CHAIN',
      severity: 'CRITICAL',
      title: 'Chain scanner has stopped reporting',
      message:
        'No successful BSC worker run has been recorded for more than two minutes.',
      metadata: { lastRunAt: chain?.lastRunAt?.toISOString() ?? null },
    },
    {
      key: 'mt5:stale',
      unhealthy: mt5AgeMs > 2 * 60_000 || mt5?.status === 'OFFLINE',
      component: 'MT5',
      severity: 'CRITICAL',
      title: 'MT5 reporting feed is stale',
      message:
        'The MT5 reporting feed has not synchronized successfully within two minutes.',
      metadata: {
        status: mt5?.status ?? 'UNCONFIGURED',
        lastSuccessfulSyncAt: mt5?.lastSuccessfulSyncAt?.toISOString() ?? null,
      },
    },
  ]
  await Promise.all(signals.map(applySignal))
  return { chain, mt5, lastRun, lag, chainAgeMs, mt5AgeMs }
}

export async function getRecentOperationalEvents(limit = 25) {
  return getDb()
    .select()
    .from(operationalEvents)
    .orderBy(desc(operationalEvents.lastObservedAt))
    .limit(limit)
}
