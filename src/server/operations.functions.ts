import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  chainWatcherState,
  chainWorkerRuns,
  operationalEvents,
} from '#/db/schema'
import { getSessionUser } from './session'
import { evaluateOperationalHealth } from './operations.service'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

export const getOperationsDashboard = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const health = await evaluateOperationalHealth()
    const [runs, events] = await Promise.all([
      getDb()
        .select()
        .from(chainWorkerRuns)
        .orderBy(desc(chainWorkerRuns.finishedAt))
        .limit(20),
      getDb()
        .select({
          id: operationalEvents.id,
          component: operationalEvents.component,
          severity: operationalEvents.severity,
          status: operationalEvents.status,
          title: operationalEvents.title,
          message: operationalEvents.message,
          openedAt: operationalEvents.openedAt,
          lastObservedAt: operationalEvents.lastObservedAt,
          resolvedAt: operationalEvents.resolvedAt,
        })
        .from(operationalEvents)
        .orderBy(desc(operationalEvents.lastObservedAt))
        .limit(30),
    ])
    return {
      ...health,
      runs,
      events,
      signerConfigured: Boolean(
        process.env.SIGNER_URL && process.env.SIGNER_API_TOKEN,
      ),
    }
  },
)

export const checkpointChainScanner = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      confirmation: z.literal('RESET SCANNER'),
      reason: z.string().trim().min(10).max(300),
      safetyOffset: z.number().int().min(2).max(100).default(10),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const db = getDb()
    const state = await db
      .select()
      .from(chainWatcherState)
      .where(eq(chainWatcherState.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!state?.lastHeadBlock)
      throw new Error('The scanner has not recorded a chain head yet')
    const target = Math.max(0, state.lastHeadBlock - data.safetyOffset)
    if (target <= state.lastScannedBlock)
      throw new Error('The scanner is already at or ahead of this checkpoint')
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(chainWatcherState)
        .set({
          lastScannedBlock: target,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(chainWatcherState.id, 1))
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: 'CHAIN_SCANNER_CHECKPOINTED',
        entityType: 'chain_watcher_state',
        entityId: '1',
        before: {
          lastScannedBlock: state.lastScannedBlock,
          lastHeadBlock: state.lastHeadBlock,
        },
        after: {
          lastScannedBlock: target,
          safetyOffset: data.safetyOffset,
          skippedFrom: state.lastScannedBlock + 1,
          skippedTo: target,
          reason: data.reason,
        },
      })
      await tx.insert(operationalEvents).values({
        eventKey: `chain:checkpoint:${now.getTime()}`,
        component: 'CHAIN',
        severity: 'INFO',
        status: 'RESOLVED',
        title: 'Scanner checkpoint changed by administrator',
        message: `Scanner advanced from block ${state.lastScannedBlock} to ${target}.`,
        metadata: { reason: data.reason, safetyOffset: data.safetyOffset },
        openedAt: now,
        lastObservedAt: now,
        resolvedAt: now,
      })
    })
    return { success: true, previous: state.lastScannedBlock, target }
  })
