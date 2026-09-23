import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq, like, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  chainWatcherState,
  controlledWalletTransfers,
  custodySettings,
  deposits,
  ledgerAccounts,
  ledgerEntries,
  platformWallets,
  platformWalletTransactions,
  treasuryTransfers,
  withdrawals,
} from '#/db/schema'
import { formatUsdt, money } from '#/domain/money'
import { chainWorkerHealth } from '#/domain/chain-worker'
import { configuredRpcUrls, sanitizedRpcHostname } from '#/domain/rpc-pool'
import { reserveRequirement } from '#/domain/treasury'
import { postLedgerTransaction } from './ledger.service'
import { recordTreasuryReturn } from './custody.service'
import { getSessionUser } from './session'

const classifications = [
  'MT5_RETURN',
  'WITHDRAWAL_LIQUIDITY',
  'RESERVE_TOP_UP',
  'OPERATIONS_REFUND',
  'OTHER',
] as const

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

export const getPlatformWalletDashboard = createServerFn({
  method: 'GET',
}).handler(async () => {
  await requireAdmin()
  const db = getDb()
  const [
    wallets,
    transactions,
    settings,
    withdrawable,
    pendingWithdrawals,
    watcher,
    pendingChainTransfers,
    pendingTreasuryTransfers,
  ] = await Promise.all([
    db.select().from(platformWallets).orderBy(asc(platformWallets.role)),
    db
      .select({
        id: platformWalletTransactions.id,
        walletRole: platformWallets.role,
        walletAddress: platformWallets.address,
        txHash: platformWalletTransactions.txHash,
        direction: platformWalletTransactions.direction,
        asset: platformWalletTransactions.asset,
        amount: platformWalletTransactions.amount,
        fromAddress: platformWalletTransactions.fromAddress,
        toAddress: platformWalletTransactions.toAddress,
        status: platformWalletTransactions.status,
        confirmations: platformWalletTransactions.confirmations,
        classification: platformWalletTransactions.classification,
        adminNote: platformWalletTransactions.adminNote,
        observedAt: platformWalletTransactions.observedAt,
      })
      .from(platformWalletTransactions)
      .innerJoin(
        platformWallets,
        eq(platformWallets.id, platformWalletTransactions.platformWalletId),
      )
      .orderBy(desc(platformWalletTransactions.observedAt))
      .limit(250),
    db
      .select()
      .from(custodySettings)
      .where(eq(custodySettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select({
        value: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(like(ledgerAccounts.code, 'USER:%:AVAILABLE'))
      .then((rows) => rows.at(0)?.value ?? '0'),
    db
      .select({
        value: sql<string>`coalesce(sum(${withdrawals.amount}), 0)`,
      })
      .from(withdrawals)
      .where(
        sql`${withdrawals.status} in ('REQUESTED', 'APPROVED', 'PROCESSING', 'BROADCAST')`,
      )
      .then((rows) => rows.at(0)?.value ?? '0'),
    db
      .select()
      .from(chainWatcherState)
      .where(eq(chainWatcherState.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(controlledWalletTransfers)
      .where(
        sql`${controlledWalletTransfers.status} in ('APPROVED', 'PROCESSING', 'BROADCAST')`,
      )
      .then((rows) => rows.at(0)?.value ?? 0),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(treasuryTransfers)
      .where(
        sql`${treasuryTransfers.status} in ('APPROVED', 'PROCESSING', 'BROADCAST')`,
      )
      .then((rows) => rows.at(0)?.value ?? 0),
  ])
  const hot = wallets.find((wallet) => wallet.role === 'HOT_WITHDRAWAL')
  const gas = wallets.find((wallet) => wallet.role === 'SWEEP_GAS')
  const requiredReserve = settings
    ? reserveRequirement(
        withdrawable,
        settings.reserveFixed,
        settings.reservePercent,
      )
    : money(0)
  const unclassified = transactions.filter(
    (transaction) =>
      transaction.direction === 'INCOMING' && !transaction.classification,
  )
  const unclassifiedUsdt = unclassified
    .filter((transaction) => transaction.asset === 'USDT')
    .reduce((total, transaction) => total.add(transaction.amount), money(0))
  const lowGasThreshold = money(process.env.LOW_GAS_BNB_THRESHOLD ?? '0.005')
  const estimatedSweepCost = money(
    process.env.ESTIMATED_SWEEP_GAS_BNB ?? '0.0002',
  )
  const gasBalance = money(gas?.nativeBalance ?? 0)
  const health = chainWorkerHealth(
    watcher?.lastScannedBlock ?? 0,
    watcher?.lastHeadBlock ?? watcher?.lastScannedBlock ?? 0,
  )
  const rpcHealth = watcher?.lastRunAt ? health.status : 'OFFLINE'
  const rpcUrls = configuredRpcUrls()
  const activeRpcIndex = watcher?.activeRpcIndex ?? 0
  const rpcProvider = rpcUrls.length
    ? sanitizedRpcHostname(rpcUrls[activeRpcIndex % rpcUrls.length])
    : 'Not configured'
  return {
    wallets,
    transactions,
    classifications,
    summary: {
      hotUsdt: formatUsdt(hot?.tokenBalance ?? 0),
      gasBnb: gasBalance.toFixed(6),
      pendingWithdrawals: formatUsdt(pendingWithdrawals),
      requiredReserve: formatUsdt(requiredReserve),
      unclassifiedIncoming: formatUsdt(unclassifiedUsdt),
      unclassifiedCount: unclassified.length,
      lowGas: gasBalance.lessThan(lowGasThreshold),
      estimatedSweeps: estimatedSweepCost.greaterThan(0)
        ? gasBalance.dividedToIntegerBy(estimatedSweepCost).toString()
        : '0',
      rpcProvider,
      rpcEndpointCount: rpcUrls.length,
      activeRpc: rpcUrls.length ? activeRpcIndex + 1 : null,
      rpcFailoverCount: watcher?.rpcFailoverCount ?? 0,
      lastRpcFailoverAt: watcher?.lastRpcFailoverAt ?? null,
      rpcHealth,
      blockLag: health.blockLag,
      lastScannedBlock: watcher?.lastScannedBlock ?? null,
      lastHeadBlock: watcher?.lastHeadBlock ?? null,
      lastRunAt: watcher?.lastRunAt ?? null,
      lastError: watcher?.lastError ?? null,
      pendingChainTransfers: pendingChainTransfers + pendingTreasuryTransfers,
    },
  }
})

export const classifyPlatformTransaction = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      transactionId: z.string().uuid(),
      classification: z.enum(classifications),
      note: z.string().trim().min(3).max(250),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const db = getDb()
    const transaction = await db
      .select()
      .from(platformWalletTransactions)
      .where(eq(platformWalletTransactions.id, data.transactionId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (
      !transaction ||
      transaction.direction !== 'INCOMING' ||
      transaction.asset !== 'USDT'
    )
      throw new Error('An incoming USDT transaction is required')
    if (transaction.classification)
      throw new Error('This transaction is already classified')
    const recordedDeposit = await db
      .select({ id: deposits.id })
      .from(deposits)
      .where(
        sql`lower(${deposits.txHash}) = lower(${transaction.txHash}) and ${deposits.status} = 'CONFIRMED'`,
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (recordedDeposit)
      throw new Error(
        'This incoming transaction already backs a confirmed user deposit and must not be classified again',
      )

    let relatedTransferId: string | undefined
    if (data.classification === 'MT5_RETURN') {
      const existing = await db
        .select({ id: treasuryTransfers.id })
        .from(treasuryTransfers)
        .where(eq(treasuryTransfers.txHash, transaction.txHash))
        .limit(1)
        .then((rows) => rows.at(0))
      const transfer =
        existing ??
        (await recordTreasuryReturn({
          amount: transaction.amount,
          txHash: transaction.txHash,
          reason: data.note,
          actorUserId: admin.id,
        }))
      relatedTransferId = transfer.id
    } else {
      await db.transaction(async (tx) => {
        const accounts = await tx
          .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
          .from(ledgerAccounts)
          .where(
            sql`${ledgerAccounts.code} in ('PLATFORM:HOT_WALLET', 'PLATFORM:CAPITAL_CONTRIBUTION')`,
          )
        const byCode = Object.fromEntries(
          accounts.map((account) => [account.code, account.id]),
        )
        const hot = byCode['PLATFORM:HOT_WALLET']
        const capital = byCode['PLATFORM:CAPITAL_CONTRIBUTION']
        if (!hot || !capital)
          throw new Error('Platform funding ledger accounts are missing')
        const transfer = await tx
          .insert(treasuryTransfers)
          .values({
            amount: transaction.amount,
            destination: 'PLATFORM_HOT_WALLET',
            direction: 'RETURN',
            purpose: data.classification,
            reason: data.note,
            status: 'CONFIRMED',
            txHash: transaction.txHash,
            createdBy: admin.id,
            broadcastAt: transaction.observedAt,
            confirmedAt: new Date(),
          })
          .returning({ id: treasuryTransfers.id })
          .then((rows) => rows.at(0))
        if (!transfer) throw new Error('Could not record incoming funding')
        relatedTransferId = transfer.id
        const ledger = await postLedgerTransaction(tx, {
          eventType: 'PLATFORM_FUNDING_RECEIVED',
          referenceType: 'treasury_transfer',
          referenceId: transfer.id,
          idempotencyKey: `platform-funding:${transaction.id}`,
          description: data.note,
          effectiveAt: transaction.observedAt,
          createdBy: admin.id,
          lines: [
            {
              accountId: hot,
              side: 'DEBIT',
              amount: money(transaction.amount),
            },
            {
              accountId: capital,
              side: 'CREDIT',
              amount: money(transaction.amount),
            },
          ],
        })
        await tx
          .update(treasuryTransfers)
          .set({
            hotWalletLedgerTransactionId: ledger.id,
            updatedAt: new Date(),
          })
          .where(eq(treasuryTransfers.id, transfer.id))
      })
    }

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(platformWalletTransactions)
        .set({
          classification: data.classification,
          adminNote: data.note,
          relatedType: 'treasury_transfer',
          relatedId: relatedTransferId,
          classifiedBy: admin.id,
          classifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          sql`${platformWalletTransactions.id} = ${transaction.id} and ${platformWalletTransactions.classification} is null`,
        )
        .returning({ id: platformWalletTransactions.id })
      if (updated.length !== 1)
        throw new Error('Transaction classification changed; refresh and retry')
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: 'PLATFORM_TRANSACTION_CLASSIFIED',
        entityType: 'platform_wallet_transaction',
        entityId: transaction.id,
        before: { classification: null },
        after: { classification: data.classification, note: data.note },
      })
    })
    return { success: true }
  })
