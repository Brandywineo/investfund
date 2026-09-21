import { createServerFn } from '@tanstack/react-start'
import { desc, eq, like, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  custodySettings,
  deposits,
  ledgerAccounts,
  ledgerEntries,
  treasuryTransfers,
  users,
  withdrawals,
} from '#/db/schema'
import { formatUsdt, money } from '#/domain/money'
import {
  availableTreasuryLiquidity,
  reserveRequirement,
} from '#/domain/treasury'
import {
  approveWithdrawal,
  advanceTreasuryStatus,
  broadcastTreasuryTransfer,
  broadcastWithdrawal,
  confirmDeposit,
  creditBrokerTransfer,
  releaseApprovedWithdrawal,
} from './custody.service'
import { getSessionUser } from './session'

const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/)
  .refine((value) => Number(value) > 0, 'Amount must be positive')
const referenceSchema = z.string().trim().min(8).max(160)

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

export const getCustodyAccount = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const db = getDb()
    const [settings, userDeposits, userWithdrawals] = await Promise.all([
      db
        .select()
        .from(custodySettings)
        .where(eq(custodySettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select()
        .from(deposits)
        .where(eq(deposits.userId, user.id))
        .orderBy(desc(deposits.createdAt))
        .limit(50),
      db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id))
        .orderBy(desc(withdrawals.createdAt))
        .limit(50),
    ])
    if (!settings) throw new Error('Custody settings are not initialized')
    return { settings, deposits: userDeposits, withdrawals: userWithdrawals }
  },
)

export const submitDeposit = createServerFn({ method: 'POST' })
  .validator(z.object({ amount: amountSchema, txHash: referenceSchema }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const settings = await getDb()
      .select()
      .from(custodySettings)
      .where(eq(custodySettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!settings?.depositAddress)
      throw new Error('Deposits are not configured yet')
    const deposit = await getDb()
      .insert(deposits)
      .values({
        userId: user.id,
        amount: data.amount,
        network: settings.network,
        txHash: data.txHash,
      })
      .returning({ id: deposits.id })
      .then((rows) => rows.at(0))
    return { success: true, depositId: deposit?.id }
  })

export const requestWithdrawal = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      amount: amountSchema,
      destinationAddress: z.string().trim().min(20).max(160),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const settings = await getDb()
      .select()
      .from(custodySettings)
      .where(eq(custodySettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!settings) throw new Error('Custody settings are not initialized')
    const withdrawal = await getDb()
      .insert(withdrawals)
      .values({
        userId: user.id,
        amount: data.amount,
        destinationAddress: data.destinationAddress,
        network: settings.network,
      })
      .returning({ id: withdrawals.id })
      .then((rows) => rows.at(0))
    return { success: true, withdrawalId: withdrawal?.id }
  })

export const cancelWithdrawal = createServerFn({ method: 'POST' })
  .validator(z.object({ withdrawalId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const result = await getDb()
      .update(withdrawals)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(
        sql`${withdrawals.id} = ${data.withdrawalId} and ${withdrawals.userId} = ${user.id} and ${withdrawals.status} = 'REQUESTED'`,
      )
      .returning({ id: withdrawals.id })
    if (result.length !== 1)
      throw new Error('Only a requested withdrawal can be cancelled')
    return { success: true }
  })

export const getCustodyDashboard = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const db = getDb()
    const [
      settings,
      platformBalances,
      withdrawable,
      totalUserLiabilities,
      depositRows,
      withdrawalRows,
      transferRows,
    ] = await Promise.all([
      db
        .select()
        .from(custodySettings)
        .where(eq(custodySettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({
          code: ledgerAccounts.code,
          normal: ledgerAccounts.normalBalance,
          debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
          credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
        })
        .from(ledgerAccounts)
        .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
        .where(like(ledgerAccounts.code, 'PLATFORM:%'))
        .groupBy(ledgerAccounts.code, ledgerAccounts.normalBalance),
      db
        .select({
          value: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`,
        })
        .from(ledgerEntries)
        .innerJoin(
          ledgerAccounts,
          eq(ledgerAccounts.id, ledgerEntries.accountId),
        )
        .where(like(ledgerAccounts.code, 'USER:%:AVAILABLE'))
        .then((rows) => rows.at(0)?.value ?? '0'),
      db
        .select({
          value: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`,
        })
        .from(ledgerEntries)
        .innerJoin(
          ledgerAccounts,
          eq(ledgerAccounts.id, ledgerEntries.accountId),
        )
        .where(like(ledgerAccounts.code, 'USER:%'))
        .then((rows) => rows.at(0)?.value ?? '0'),
      db
        .select({
          id: deposits.id,
          userEmail: users.email,
          amount: deposits.amount,
          network: deposits.network,
          txHash: deposits.txHash,
          status: deposits.status,
          createdAt: deposits.createdAt,
        })
        .from(deposits)
        .innerJoin(users, eq(users.id, deposits.userId))
        .orderBy(desc(deposits.createdAt))
        .limit(100),
      db
        .select({
          id: withdrawals.id,
          userEmail: users.email,
          amount: withdrawals.amount,
          destinationAddress: withdrawals.destinationAddress,
          txHash: withdrawals.txHash,
          status: withdrawals.status,
          createdAt: withdrawals.createdAt,
        })
        .from(withdrawals)
        .innerJoin(users, eq(users.id, withdrawals.userId))
        .orderBy(desc(withdrawals.createdAt))
        .limit(100),
      db
        .select()
        .from(treasuryTransfers)
        .orderBy(desc(treasuryTransfers.createdAt))
        .limit(100),
    ])
    if (!settings) throw new Error('Custody settings are not initialized')
    const balances = Object.fromEntries(
      platformBalances.map((row) => [
        row.code,
        row.normal === 'DEBIT'
          ? money(row.debit).minus(row.credit).toString()
          : money(row.credit).minus(row.debit).toString(),
      ]),
    )
    const hotWallet = String(balances['PLATFORM:HOT_WALLET'] ?? 0)
    const reserved = String(balances['PLATFORM:WITHDRAWAL_RESERVED'] ?? 0)
    const required = reserveRequirement(
      withdrawable,
      settings.reserveFixed,
      settings.reservePercent,
    )
    const totalAssets = money(hotWallet)
      .add(balances['PLATFORM:TREASURY_IN_TRANSIT'] ?? 0)
      .add(balances['PLATFORM:BROKER_TREASURY'] ?? 0)
    const totalLiabilities = money(totalUserLiabilities).add(reserved)
    return {
      settings,
      summary: {
        hotWallet: formatUsdt(hotWallet),
        withdrawalReserved: formatUsdt(reserved),
        treasuryInTransit: formatUsdt(
          balances['PLATFORM:TREASURY_IN_TRANSIT'] ?? 0,
        ),
        brokerTreasury: formatUsdt(balances['PLATFORM:BROKER_TREASURY'] ?? 0),
        withdrawableLiabilities: formatUsdt(withdrawable),
        requiredReserve: formatUsdt(required),
        transferable: formatUsdt(
          availableTreasuryLiquidity(hotWallet, reserved, required.toString()),
        ),
        totalAssets: formatUsdt(totalAssets),
        totalLiabilities: formatUsdt(totalLiabilities),
        reconciliationDifference: formatUsdt(
          totalAssets.minus(totalLiabilities),
        ),
        unreconciledItems: String(
          transferRows.filter(
            (item) => !['RECONCILED', 'FAILED'].includes(item.status),
          ).length +
            withdrawalRows.filter((item) =>
              ['APPROVED', 'BROADCAST'].includes(item.status),
            ).length,
        ),
      },
      deposits: depositRows,
      withdrawals: withdrawalRows,
      transfers: transferRows,
    }
  },
)

export const updateCustodySettings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      network: z.string().trim().min(2).max(30),
      depositAddress: z.string().trim().min(20).max(160),
      confirmationThreshold: z.number().int().min(1).max(1000),
      reserveFixed: z.number().min(0).max(1_000_000_000),
      reservePercent: z.number().min(0).max(100),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    await getDb().transaction(async (tx) => {
      const before = await tx
        .select()
        .from(custodySettings)
        .where(eq(custodySettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0))
      await tx
        .update(custodySettings)
        .set({
          network: data.network,
          depositAddress: data.depositAddress,
          confirmationThreshold: data.confirmationThreshold,
          reserveFixed: String(data.reserveFixed),
          reservePercent: String(data.reservePercent),
          updatedAt: new Date(),
        })
        .where(eq(custodySettings.id, 1))
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: 'CUSTODY_SETTINGS_UPDATED',
        entityType: 'custody_settings',
        entityId: '1',
        before,
        after: data,
      })
    })
    return { success: true }
  })

export const reviewDeposit = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      depositId: z.string().uuid(),
      action: z.enum(['CONFIRM', 'REJECT']),
      reason: z.string().trim().max(250).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (data.action === 'CONFIRM')
      await confirmDeposit(data.depositId, admin.id)
    else {
      if (!data.reason || data.reason.length < 3)
        throw new Error('A rejection reason is required')
      const result = await getDb()
        .update(deposits)
        .set({
          status: 'REJECTED',
          rejectionReason: data.reason,
          confirmedBy: admin.id,
          updatedAt: new Date(),
        })
        .where(
          sql`${deposits.id} = ${data.depositId} and ${deposits.status} = 'PENDING'`,
        )
        .returning({ id: deposits.id })
      if (result.length !== 1) throw new Error('Pending deposit not found')
    }
    return { success: true }
  })

export const createTreasuryTransfer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      amount: amountSchema,
      destination: z.string().trim().min(3).max(160),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    await getDb().insert(treasuryTransfers).values({
      amount: data.amount,
      destination: data.destination,
      createdBy: admin.id,
    })
    return { success: true }
  })

export const advanceTreasuryTransfer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      transferId: z.string().uuid(),
      action: z.enum([
        'APPROVE',
        'BROADCAST',
        'CHAIN_CONFIRM',
        'BROKER_CREDIT',
        'RECONCILE',
      ]),
      reference: referenceSchema,
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (data.action === 'APPROVE') {
      await advanceTreasuryStatus(
        data.transferId,
        'DRAFTED',
        'APPROVED',
        admin.id,
      )
    } else if (data.action === 'BROADCAST')
      await broadcastTreasuryTransfer(data.transferId, data.reference, admin.id)
    else if (data.action === 'CHAIN_CONFIRM') {
      await advanceTreasuryStatus(
        data.transferId,
        'BROADCAST',
        'CONFIRMED',
        admin.id,
      )
    } else if (data.action === 'BROKER_CREDIT')
      await creditBrokerTransfer(data.transferId, data.reference, admin.id)
    else {
      await advanceTreasuryStatus(
        data.transferId,
        'BROKER_CREDITED',
        'RECONCILED',
        admin.id,
      )
    }
    return { success: true }
  })

export const reviewWithdrawal = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      withdrawalId: z.string().uuid(),
      action: z.enum([
        'APPROVE',
        'REJECT',
        'BROADCAST',
        'CONFIRM',
        'FAIL_APPROVED',
      ]),
      reference: z.string().trim().max(160).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (data.action === 'APPROVE')
      await approveWithdrawal(data.withdrawalId, admin.id)
    else if (data.action === 'FAIL_APPROVED') {
      await releaseApprovedWithdrawal(
        data.withdrawalId,
        admin.id,
        data.reference || 'Broadcast failed before funds were sent',
      )
    } else if (data.action === 'BROADCAST') {
      if (!data.reference || data.reference.length < 8)
        throw new Error('A transaction hash is required')
      await broadcastWithdrawal(data.withdrawalId, data.reference, admin.id)
    } else if (data.action === 'CONFIRM') {
      const result = await getDb()
        .update(withdrawals)
        .set({
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          sql`${withdrawals.id} = ${data.withdrawalId} and ${withdrawals.status} = 'BROADCAST'`,
        )
        .returning({ id: withdrawals.id })
      if (result.length !== 1) throw new Error('Broadcast withdrawal not found')
    } else {
      const result = await getDb()
        .update(withdrawals)
        .set({
          status: 'REJECTED',
          rejectionReason: data.reference || 'Rejected by administrator',
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          sql`${withdrawals.id} = ${data.withdrawalId} and ${withdrawals.status} = 'REQUESTED'`,
        )
        .returning({ id: withdrawals.id })
      if (result.length !== 1) throw new Error('Requested withdrawal not found')
    }
    return { success: true }
  })
