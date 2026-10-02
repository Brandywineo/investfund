import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  deposits,
  users,
  walletAddresses,
  walletSets,
  withdrawals,
} from '#/db/schema'
import { getSessionUser } from './session'
import { rotateUserWalletAddress } from './wallet-address.service'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  return getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      depositAddress: walletAddresses.address,
      derivationIndex: walletAddresses.derivationIndex,
      addressStatus: walletAddresses.status,
      walletSetId: walletAddresses.walletSetId,
      walletSetName: walletSets.name,
      confirmedDeposits: sql<string>`coalesce((select sum(${deposits.amount}) from ${deposits} where ${deposits.userId} = ${users.id} and ${deposits.status} = 'CONFIRMED'), 0)`,
      confirmedWithdrawals: sql<string>`coalesce((select sum(${withdrawals.amount}) from ${withdrawals} where ${withdrawals.userId} = ${users.id} and ${withdrawals.status} = 'CONFIRMED'), 0)`,
    })
    .from(users)
    .leftJoin(
      walletAddresses,
      and(
        eq(walletAddresses.userId, users.id),
        eq(walletAddresses.status, 'ACTIVE'),
      ),
    )
    .leftJoin(walletSets, eq(walletSets.id, walletAddresses.walletSetId))
    .orderBy(asc(users.createdAt))
    .limit(250)
})

export const listWalletSetOptions = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return getDb()
      .select({
        id: walletSets.id,
        name: walletSets.name,
        status: walletSets.status,
      })
      .from(walletSets)
      .orderBy(asc(walletSets.createdAt))
  },
)

export const rotateUserDepositAddress = createServerFn({ method: 'POST' })
  .validator(
    z.object({ userId: z.string().uuid(), walletSetId: z.string().uuid() }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const address = await rotateUserWalletAddress(data.userId, data.walletSetId)
    await getDb()
      .insert(auditLogs)
      .values({
        actorUserId: admin.id,
        action: 'USER_DEPOSIT_ADDRESS_ROTATED',
        entityType: 'user',
        entityId: data.userId,
        after: {
          walletSetId: data.walletSetId,
          walletAddressId: address?.id,
          address: address?.address,
        },
      })
    return address
  })

export const updateUserAccess = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      userId: z.string().uuid(),
      role: z.enum(['USER', 'MANAGER', 'ADMIN']),
      status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (
      admin.id === data.userId &&
      (data.role !== 'ADMIN' || data.status !== 'ACTIVE')
    ) {
      throw new Error(
        'You cannot remove or suspend your own administrator access',
      )
    }

    await getDb().transaction(async (tx) => {
      const target = await tx
        .select({ role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, data.userId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (!target) throw new Error('User not found')
      if (
        target.role === 'ADMIN' &&
        target.status === 'ACTIVE' &&
        (data.role !== 'ADMIN' || data.status !== 'ACTIVE')
      ) {
        const activeAdmins = await tx
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')))
          .then((rows) => rows.at(0)?.value ?? 0)
        if (activeAdmins <= 1)
          throw new Error('At least one active administrator is required')
      }
      await tx
        .update(users)
        .set({ role: data.role, status: data.status, updatedAt: new Date() })
        .where(eq(users.id, data.userId))
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: 'USER_ACCESS_UPDATED',
        entityType: 'user',
        entityId: data.userId,
        before: target,
        after: { role: data.role, status: data.status },
      })
    })
    return { success: true }
  })
