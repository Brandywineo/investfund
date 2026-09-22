import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/db'
import { getDb } from '#/db'
import {
  auditLogs,
  deposits,
  ledgerAccounts,
  ledgerEntries,
  treasuryTransfers,
  withdrawals,
} from '#/db/schema'
import { money } from '#/domain/money'
import { calculateWithdrawal } from '#/domain/withdrawal'
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
    await tx.execute(
      sql`select id from withdrawals where id = ${withdrawalId} for update`,
    )
    const withdrawal = await tx
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!withdrawal || withdrawal.status !== 'REQUESTED')
      throw new Error('Requested withdrawal not found')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    await tx.execute(
      sql`select id from ledger_accounts where id = ${hotWallet} for update`,
    )
    if (!withdrawal.reservationLedgerTransactionId)
      throw new Error('Withdrawal funds have not been reserved')
    if (
      money(await balance(tx, hotWallet, 'DEBIT')).lessThan(
        withdrawal.netAmount,
      )
    )
      throw new Error(
        'Hot-wallet liquidity is insufficient; leave this request queued',
      )
    await tx
      .update(withdrawals)
      .set({
        status: 'APPROVED',
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
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

export async function reserveWithdrawalRequest(input: {
  userId: string
  amount: string
  destinationAddress: string
  network: string
  feePercent: string
}) {
  return getDb().transaction(async (tx) => {
    const calculated = calculateWithdrawal(input.amount, input.feePercent)
    const available = await account(tx, `USER:${input.userId}:AVAILABLE`)
    const reserved = await account(tx, 'PLATFORM:WITHDRAWAL_RESERVED')
    await tx.execute(
      sql`select id from ledger_accounts where id in (${available}, ${reserved}) for update`,
    )
    if (money(await balance(tx, available, 'CREDIT')).lessThan(input.amount))
      throw new Error('Insufficient available balance')
    const withdrawal = await tx
      .insert(withdrawals)
      .values({
        userId: input.userId,
        amount: calculated.gross.toString(),
        feePercent: calculated.rate.toString(),
        feeAmount: calculated.fee.toString(),
        netAmount: calculated.net.toString(),
        destinationAddress: input.destinationAddress,
        network: input.network,
      })
      .returning({ id: withdrawals.id })
      .then((rows) => rows.at(0))
    if (!withdrawal) throw new Error('Could not create withdrawal request')
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'WITHDRAWAL_RESERVED',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      idempotencyKey: `withdrawal:${withdrawal.id}:reserved`,
      description: 'Lock user funds for withdrawal review',
      effectiveAt: new Date(),
      lines: [
        { accountId: available, side: 'DEBIT', amount: money(input.amount) },
        { accountId: reserved, side: 'CREDIT', amount: money(input.amount) },
      ],
    })
    await tx
      .update(withdrawals)
      .set({ reservationLedgerTransactionId: ledger.id, updatedAt: new Date() })
      .where(eq(withdrawals.id, withdrawal.id))
    await audit(
      tx,
      input.userId,
      'WITHDRAWAL_REQUESTED',
      'withdrawal',
      withdrawal.id,
      null,
      {
        status: 'REQUESTED',
        amount: input.amount,
        feeAmount: calculated.fee.toString(),
        netAmount: calculated.net.toString(),
        destinationAddress: input.destinationAddress,
      },
    )
    return withdrawal
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
    const feeRevenue = await account(tx, 'PLATFORM:WITHDRAWAL_FEE_REVENUE')
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
          amount: money(withdrawal.netAmount),
        },
        ...(money(withdrawal.feeAmount).greaterThan(0)
          ? [
              {
                accountId: feeRevenue,
                side: 'CREDIT' as const,
                amount: money(withdrawal.feeAmount),
              },
            ]
          : []),
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
    if (!transfer || transfer.status !== 'PROCESSING')
      throw new Error('Processing treasury transfer not found')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const inTransit = await account(tx, 'PLATFORM:TREASURY_IN_TRANSIT')
    await tx.execute(
      sql`select id from ledger_accounts where id = ${hotWallet} for update`,
    )
    if (money(await balance(tx, hotWallet, 'DEBIT')).lessThan(transfer.amount))
      throw new Error('Hot-wallet ledger balance is insufficient')
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

export async function failBroadcastTreasuryTransfer(transferId: string) {
  return getDb().transaction(async (tx) => {
    const transfer = await tx
      .select()
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.id, transferId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!transfer || transfer.status !== 'BROADCAST')
      throw new Error('Broadcast treasury transfer not found')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const inTransit = await account(tx, 'PLATFORM:TREASURY_IN_TRANSIT')
    await postLedgerTransaction(tx, {
      eventType: 'TREASURY_TRANSFER_REVERTED',
      referenceType: 'treasury_transfer',
      referenceId: transfer.id,
      idempotencyKey: `treasury:${transfer.id}:reverted`,
      description: 'Restore hot-wallet ledger after reverted treasury transfer',
      effectiveAt: new Date(),
      lines: [
        { accountId: hotWallet, side: 'DEBIT', amount: money(transfer.amount) },
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
        status: 'FAILED',
        failureReason: 'Blockchain transaction reverted',
        updatedAt: new Date(),
      })
      .where(eq(treasuryTransfers.id, transfer.id))
    await audit(
      tx,
      undefined,
      'TREASURY_TRANSFER_REVERTED',
      'treasury_transfer',
      transfer.id,
      { status: 'BROADCAST' },
      {
        status: 'FAILED',
        txHash: transfer.txHash,
      },
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
    const feeRevenue = await account(tx, 'PLATFORM:WITHDRAWAL_FEE_REVENUE')
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
          amount: money(withdrawal.netAmount),
        },
        ...(money(withdrawal.feeAmount).greaterThan(0)
          ? [
              {
                accountId: feeRevenue,
                side: 'DEBIT' as const,
                amount: money(withdrawal.feeAmount),
              },
            ]
          : []),
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
  actorUserId?: string,
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
        ...(to === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
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

export async function recordTreasuryReturn(input: {
  amount: string
  txHash: string
  reason: string
  actorUserId: string
}) {
  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: treasuryTransfers.id })
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.txHash, input.txHash))
      .limit(1)
      .then((rows) => rows.at(0))
    if (existing) throw new Error('This transaction hash is already recorded')
    const hotWallet = await account(tx, 'PLATFORM:HOT_WALLET')
    const broker = await account(tx, 'PLATFORM:BROKER_TREASURY')
    const tradingProfit = await account(tx, 'PLATFORM:TRADING_PROFIT')
    await tx.execute(
      sql`select id from ledger_accounts where id in (${hotWallet}, ${broker}) for update`,
    )
    const brokerBalance = money(await balance(tx, broker, 'DEBIT'))
    const returned = money(input.amount)
    const principalReturned = brokerBalance.lessThan(returned)
      ? brokerBalance
      : returned
    const profitReturned = returned.minus(principalReturned)
    const transfer = await tx
      .insert(treasuryTransfers)
      .values({
        amount: input.amount,
        destination: 'PLATFORM_HOT_WALLET',
        direction: 'RETURN',
        reason: input.reason,
        status: 'CONFIRMED',
        txHash: input.txHash,
        createdBy: input.actorUserId,
        broadcastAt: new Date(),
        confirmedAt: new Date(),
      })
      .returning({ id: treasuryTransfers.id })
      .then((rows) => rows.at(0))
    if (!transfer) throw new Error('Could not record treasury return')
    const ledger = await postLedgerTransaction(tx, {
      eventType: 'BROKER_TREASURY_RETURNED',
      referenceType: 'treasury_transfer',
      referenceId: transfer.id,
      idempotencyKey: `treasury:${transfer.id}:returned`,
      description: input.reason,
      effectiveAt: new Date(),
      createdBy: input.actorUserId,
      lines: [
        { accountId: hotWallet, side: 'DEBIT', amount: returned },
        ...(principalReturned.greaterThan(0)
          ? [
              {
                accountId: broker,
                side: 'CREDIT' as const,
                amount: principalReturned,
              },
            ]
          : []),
        ...(profitReturned.greaterThan(0)
          ? [
              {
                accountId: tradingProfit,
                side: 'CREDIT' as const,
                amount: profitReturned,
              },
            ]
          : []),
      ],
    })
    await tx
      .update(treasuryTransfers)
      .set({ hotWalletLedgerTransactionId: ledger.id, updatedAt: new Date() })
      .where(eq(treasuryTransfers.id, transfer.id))
    await audit(
      tx,
      input.actorUserId,
      'BROKER_TREASURY_RETURNED',
      'treasury_transfer',
      transfer.id,
      null,
      {
        amount: input.amount,
        txHash: input.txHash,
        reason: input.reason,
      },
    )
    return transfer
  })
}

export async function releaseApprovedWithdrawal(
  withdrawalId: string,
  actorUserId: string,
  reason: string,
  finalStatus?: 'REJECTED' | 'CANCELLED' | 'FAILED',
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select id from withdrawals where id = ${withdrawalId} for update`,
    )
    const withdrawal = await tx
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (
      !withdrawal ||
      !['REQUESTED', 'APPROVED', 'FAILED'].includes(withdrawal.status)
    )
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
    const releasedStatus =
      finalStatus ?? (withdrawal.status === 'REQUESTED' ? 'REJECTED' : 'FAILED')
    await tx
      .update(withdrawals)
      .set({
        status: releasedStatus,
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
      { status: releasedStatus, reason },
    )
  })
}
