import { createServerFn } from '@tanstack/react-start'
import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  platformWallets,
  walletAddresses,
  walletSets,
} from '#/db/schema'
import { getSessionUser } from './session'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

export const listWalletSets = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const db = getDb()
    const sets = await db
      .select({
        id: walletSets.id,
        name: walletSets.name,
        signerKey: walletSets.signerKey,
        fingerprint: walletSets.fingerprint,
        status: walletSets.status,
        activatedAt: walletSets.activatedAt,
        retiredAt: walletSets.retiredAt,
        createdAt: walletSets.createdAt,
        assignedUsers: sql<number>`count(distinct ${walletAddresses.userId})::int`,
      })
      .from(walletSets)
      .leftJoin(walletAddresses, eq(walletAddresses.walletSetId, walletSets.id))
      .groupBy(walletSets.id)
      .orderBy(asc(walletSets.createdAt))
    const wallets = await db
      .select()
      .from(platformWallets)
      .orderBy(asc(platformWallets.createdAt))
    return sets.map((set) => ({
      ...set,
      wallets: wallets.filter((wallet) => wallet.walletSetId === set.id),
    }))
  },
)

export const updateWalletSet = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      walletSetId: z.string().uuid(),
      action: z.enum(['ACTIVATE', 'DRAIN', 'RETIRE']),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(784221)`)
      const target = await tx
        .select()
        .from(walletSets)
        .where(eq(walletSets.id, data.walletSetId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (!target) throw new Error('Wallet set not found')
      if (data.action === 'ACTIVATE') {
        if (target.status === 'RETIRED')
          throw new Error('A retired wallet set cannot be reactivated')
        await tx
          .update(walletSets)
          .set({ status: 'DRAINING', updatedAt: new Date() })
          .where(eq(walletSets.status, 'ACTIVE'))
        await tx
          .update(walletSets)
          .set({
            status: 'ACTIVE',
            activatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(walletSets.id, target.id))
      } else if (data.action === 'DRAIN') {
        if (target.status === 'ACTIVE')
          throw new Error(
            'Activate another wallet set before draining this one',
          )
        await tx
          .update(walletSets)
          .set({ status: 'DRAINING', updatedAt: new Date() })
          .where(eq(walletSets.id, target.id))
      } else {
        if (target.status === 'ACTIVE')
          throw new Error('The active wallet set cannot be retired')
        const liveAddresses = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(walletAddresses)
          .where(
            sql`${walletAddresses.walletSetId} = ${target.id} and ${walletAddresses.status} = 'ACTIVE'`,
          )
          .then((rows) => rows.at(0)?.count ?? 0)
        if (liveAddresses > 0)
          throw new Error(
            'Rotate remaining active user addresses before retirement',
          )
        await tx
          .update(walletSets)
          .set({
            status: 'RETIRED',
            retiredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(walletSets.id, target.id))
      }
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: `WALLET_SET_${data.action}`,
        entityType: 'wallet_set',
        entityId: target.id,
        before: { status: target.status },
        after: { action: data.action },
      })
    })
    return { success: true }
  })
