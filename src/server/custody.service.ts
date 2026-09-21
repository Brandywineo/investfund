import { eq, like, sql } from 'drizzle-orm'
import type { Database } from '#/db'
import { getDb } from '#/db'
import {
  auditLogs,
  custodySettings,
  deposits,
  ledgerAccounts,
  ledgerEntries,
  treasuryTransfers,
  withdrawals,
} from '#/db/schema'
import { money } from '#/domain/money'
import {
  availableTreasuryLiquidity,
  reserveRequirement,
} from '#/domain/treasury'
import { postLedgerTransaction } from './ledger.service'

type TransactionExecutor = Parameters<Parameters<Database['transaction']>[0]>[0]

async function account(tx: TransactionExecutor, code: string) {
  const row = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.code, code))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!row) throw new Error(`Required ledger account is missing: ${code}`)
  return row.id
}

async function balance(
  tx: TransactionExecutor,
  accountId: string,
  normal: 'DEBIT' | 'CREDIT',
) {
  const expression =
    normal === 'DEBIT'
      ? sql<string>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)`
      : sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`
  return tx
    .select({ value: expression })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId))
    .then((rows) => rows.at(0)?.value ?? '0')
}

async function audit(
  tx: TransactionExecutor,
  actorUserId: string | undefined,
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  await tx
    .insert(auditLogs)
    .values({ actorUserId, action, entityType, entityId, before, after })
}

export async function confirmDeposit(depositId: string, actorUserId?: string) {
  return getDb().transaction(async (tx) => {
    const deposit = await tx
      .select()
      .from(deposits)
      .where(eq(deposits.id, depositId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!deposit || deposit.status !== 'PENDING')
      throw new Error('Pending deposit not found')
    if (!deposit.txHash)
      throw new Error('A blockchain transaction hash is required')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const userAvailable = await account(tx, `USER:${deposit.userId}:AVAILABLE`)
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'DEPOSIT_CONFIRMED',
      referenceType: 'deposit',
      referenceId: deposit.id,
      idempotencyKey: `deposit:${deposit.id}:confirmed`,
      description: `Confirmed ${deposit.network} deposit`,
      effectiveAt: new Date(),
      createdBy: actorUserId,
      lines: [
        { accountId: hotWallet, side: 'DEBIT', amount: money(deposit.amount) },
        {
          accountId: userAvailable,
          side: 'CREDIT',
          amount: money(deposit.amount),
        },
      ],
    })
    await tx
      .update(deposits)
      .set({
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedBy: actorUserId,
        ledgerTransactionId: ledger.id,
        updatedAt: new Date(),
      })
      .where(eq(deposits.id, deposit.id))
    await audit(
      tx,
      actorUserId,
      'DEPOSIT_CONFIRMED',
      'deposit',
      deposit.id,
      { status: deposit.status },
      { status: 'CONFIRMED', txHash: deposit.txHash, amount: deposit.amount },
    )
  })
}

export async function approveWithdrawal(
  withdrawalId: string,
  actorUserId: string,
) {
  return getDb().transaction(async (tx) => {
    const withdrawal = await tx
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!withdrawal || withdrawal.status !== 'REQUESTED')
      throw new Error('Requested withdrawal not found')
    const available = await account(tx, `USER:${withdrawal.userId}:AVAILABLE`)
    const reserved = await account(tx, 'PLATFORM:WITHDRAWAL_RESERVED')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    await tx.execute(
      sql`select id from ledger_accounts where id in (${available}, ${hotWallet}) for update`,
    )
    if (
      money(await balance(tx, available, 'CREDIT')).lessThan(withdrawal.amount)
    )
      throw new Error('User has insufficient available balance')
    if (
      money(await balance(tx, hotWallet, 'DEBIT')).lessThan(withdrawal.amount)
    )
      throw new Error(
        'Hot-wallet liquidity is insufficient; leave this request queued',
      )
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'WITHDRAWAL_RESERVED',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      idempotencyKey: `withdrawal:${withdrawal.id}:reserved`,
      description: 'Reserve user funds for approved withdrawal',
      effectiveAt: new Date(),
      createdBy: actorUserId,
      lines: [
        {
          accountId: available,
          side: 'DEBIT',
          amount: money(withdrawal.amount),
        },
        {
          accountId: reserved,
          side: 'CREDIT',
          amount: money(withdrawal.amount),
        },
      ],
    })
    await tx
      .update(withdrawals)
      .set({
        status: 'APPROVED',
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
        reservationLedgerTransactionId: ledger.id,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, withdrawal.id))
    await audit(
      tx,
      actorUserId,
      'WITHDRAWAL_APPROVED',
      'withdrawal',
      withdrawal.id,
      { status: withdrawal.status },
      { status: 'APPROVED', amount: withdrawal.amount },
    )
  })
}

export async function broadcastWithdrawal(
  withdrawalId: string,
  txHash: string,
  actorUserId: string,
) {
  return getDb().transaction(async (tx) => {
    const withdrawal = await tx
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!withdrawal || withdrawal.status !== 'PROCESSING')
      throw new Error('Processing withdrawal not found')
    const reserved = await account(tx, 'PLATFORM:WITHDRAWAL_RESERVED')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'WITHDRAWAL_BROADCAST',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      idempotencyKey: `withdrawal:${withdrawal.id}:broadcast`,
      description: `Broadcast ${withdrawal.network} withdrawal`,
      effectiveAt: new Date(),
      createdBy: actorUserId,
      lines: [
        {
          accountId: reserved,
          side: 'DEBIT',
          amount: money(withdrawal.amount),
        },
        {
          accountId: hotWallet,
          side: 'CREDIT',
          amount: money(withdrawal.amount),
        },
      ],
    })
    await tx
      .update(withdrawals)
      .set({
        status: 'BROADCAST',
        txHash,
        broadcastAt: new Date(),
        paymentLedgerTransactionId: ledger.id,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, withdrawal.id))
    await audit(
      tx,
      actorUserId,
      'WITHDRAWAL_BROADCAST',
      'withdrawal',
      withdrawal.id,
      { status: withdrawal.status },
      { status: 'BROADCAST', txHash },
    )
  })
}

export async function broadcastTreasuryTransfer(
  transferId: string,
  txHash: string,
  actorUserId: string,
) {
  return getDb().transaction(async (tx) => {
    const transfer = await tx
      .select()
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.id, transferId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!transfer || transfer.status !== 'APPROVED')
      throw new Error('Approved treasury transfer not found')
    const settings = await tx
      .select()
      .from(custodySettings)
      .where(eq(custodySettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!settings) throw new Error('Custody settings are not initialized')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const inTransit = await account(tx, 'PLATFORM:TREASURY_IN_TRANSIT')
    const reserved = await account(tx, 'PLATFORM:WITHDRAWAL_RESERVED')
    await tx.execute(
      sql`select id from ledger_accounts where id = ${hotWallet} for update`,
    )
    const withdrawable = await tx
      .select({
        value: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(like(ledgerAccounts.code, 'USER:%:AVAILABLE'))
      .then((rows) => rows.at(0)?.value ?? '0')
    const requirement = reserveRequirement(
      withdrawable,
      settings.reserveFixed,
      settings.reservePercent,
    )
    const transferable = availableTreasuryLiquidity(
      await balance(tx, hotWallet, 'DEBIT'),
      await balance(tx, reserved, 'CREDIT'),
      requirement.toString(),
    )
    if (transferable.lessThan(transfer.amount))
      throw new Error(
        `Transfer would breach the withdrawal reserve; available ${transferable.toFixed(2)} USDT`,
      )
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'TREASURY_TRANSFER_BROADCAST',
      referenceType: 'treasury_transfer',
      referenceId: transfer.id,
      idempotencyKey: `treasury:${transfer.id}:broadcast`,
      description: `Transfer hot-wallet funds to ${transfer.destination}`,
      effectiveAt: new Date(),
      createdBy: actorUserId,
      lines: [
        { accountId: inTransit, side: 'DEBIT', amount: money(transfer.amount) },
        {
          accountId: hotWallet,
          side: 'CREDIT',
          amount: money(transfer.amount),
        },
      ],
    })
    await tx
      .update(treasuryTransfers)
      .set({
        status: 'BROADCAST',
        txHash,
        broadcastAt: new Date(),
        hotWalletLedgerTransactionId: ledger.id,
        updatedAt: new Date(),
      })
      .where(eq(treasuryTransfers.id, transfer.id))
    await audit(
      tx,
      actorUserId,
      'TREASURY_TRANSFER_BROADCAST',
      'treasury_transfer',
      transfer.id,
      { status: transfer.status },
      { status: 'BROADCAST', txHash, amount: transfer.amount },
    )
  })
}

export async function settleBroadcastWithdrawal(
  withdrawalId: string,
  succeeded: boolean,
) {
  return getDb().transaction(async (tx) => {
    const withdrawal = await tx
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!withdrawal || withdrawal.status !== 'BROADCAST')
      throw new Error('Broadcast withdrawal not found')
    if (succeeded) {
      await tx
        .update(withdrawals)
        .set({
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawal.id))
      await audit(
        tx,
        undefined,
        'WITHDRAWAL_CHAIN_CONFIRMED',
        'withdrawal',
        withdrawal.id,
        { status: 'BROADCAST' },
        { status: 'CONFIRMED', txHash: withdrawal.txHash },
      )
      return
    }

    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const available = await account(tx, `USER:${withdrawal.userId}:AVAILABLE`)
    await postLedgerTransaction(tx, {
      eventType: 'WITHDRAWAL_BROADCAST_REVERTED',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      idempotencyKey: `withdrawal:${withdrawal.id}:broadcast-reverted`,
      description: 'Restore funds after reverted withdrawal transaction',
      effectiveAt: new Date(),
      lines: [
        {
          accountId: hotWallet,
          side: 'DEBIT',
          amount: money(withdrawal.amount),
        },
        {
          accountId: available,
          side: 'CREDIT',
          amount: money(withdrawal.amount),
        },
      ],
    })
    await tx
      .update(withdrawals)
      .set({
        status: 'CANCELLED',
        rejectionReason: 'Blockchain transaction reverted',
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, withdrawal.id))
    await audit(
      tx,
      undefined,
      'WITHDRAWAL_CHAIN_REVERTED',
      'withdrawal',
      withdrawal.id,
      { status: 'BROADCAST' },
      { status: 'CANCELLED', txHash: withdrawal.txHash },
    )
  })
}

export async function creditBrokerTransfer(
  transferId: string,
  brokerReference: string,
  actorUserId: string,
) {
  return getDb().transaction(async (tx) => {
    const transfer = await tx
      .select()
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.id, transferId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!transfer || transfer.status !== 'CONFIRMED')
      throw new Error('Chain-confirmed treasury transfer not found')
    const inTransit = await account(tx, 'PLATFORM:TREASURY_IN_TRANSIT')
    const broker = await account(tx, 'PLATFORM:BROKER_TREASURY')
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'BROKER_TREASURY_CREDITED',
      referenceType: 'treasury_transfer',
      referenceId: transfer.id,
      idempotencyKey: `treasury:${transfer.id}:broker-credited`,
      description: 'Confirm MT5/broker treasury receipt',
      effectiveAt: new Date(),
      createdBy: actorUserId,
      lines: [
        { accountId: broker, side: 'DEBIT', amount: money(transfer.amount) },
        {
          accountId: inTransit,
          side: 'CREDIT',
          amount: money(transfer.amount),
        },
      ],
    })
    await tx
      .update(treasuryTransfers)
      .set({
        status: 'BROKER_CREDITED',
        brokerReference,
        brokerCreditedAt: new Date(),
        brokerLedgerTransactionId: ledger.id,
        updatedAt: new Date(),
      })
      .where(eq(treasuryTransfers.id, transfer.id))
    await audit(
      tx,
      actorUserId,
      'BROKER_TREASURY_CREDITED',
      'treasury_transfer',
      transfer.id,
      { status: transfer.status },
      { status: 'BROKER_CREDITED', brokerReference },
    )
  })
}

export async function advanceTreasuryStatus(
  transferId: string,
  from: 'DRAFTED' | 'BROADCAST' | 'BROKER_CREDITED',
  to: 'APPROVED' | 'CONFIRMED' | 'RECONCILED',
  actorUserId: string,
) {
  return getDb().transaction(async (tx) => {
    const transfer = await tx
      .select()
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.id, transferId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!transfer || transfer.status !== from)
      throw new Error(`${from.toLowerCase()} treasury transfer not found`)

    await tx
      .update(treasuryTransfers)
      .set({
        status: to,
        ...(to === 'RECONCILED' ? { reconciledAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(treasuryTransfers.id, transferId))
    await audit(
      tx,
      actorUserId,
      `TREASURY_TRANSFER_${to}`,
      'treasury_transfer',
      transferId,
      { status: from },
      { status: to },
    )
  })
}

export async function releaseApprovedWithdrawal(
  withdrawalId: string,
  actorUserId: string,
  reason: string,
) {
  return getDb().transaction(async (tx) => {
    const withdrawal = await tx
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!withdrawal || !['APPROVED', 'FAILED'].includes(withdrawal.status))
      throw new Error('Releasable withdrawal not found')
    const available = await account(tx, `USER:${withdrawal.userId}:AVAILABLE`)
    const reserved = await account(tx, 'PLATFORM:WITHDRAWAL_RESERVED')
    await postLedgerTransaction(tx, {
      eventType: 'WITHDRAWAL_RESERVATION_RELEASED',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      idempotencyKey: `withdrawal:${withdrawal.id}:reservation-released`,
      description: 'Release failed withdrawal reservation',
      effectiveAt: new Date(),
      createdBy: actorUserId,
      lines: [
        {
          accountId: reserved,
          side: 'DEBIT',
          amount: money(withdrawal.amount),
        },
        {
          accountId: available,
          side: 'CREDIT',
          amount: money(withdrawal.amount),
        },
      ],
    })
    await tx
      .update(withdrawals)
      .set({
        status: 'FAILED',
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.id, withdrawal.id))
    await audit(
      tx,
      actorUserId,
      'WITHDRAWAL_RESERVATION_RELEASED',
      'withdrawal',
      withdrawal.id,
      { status: withdrawal.status },
      { status: 'FAILED', reason },
    )
  })
}
