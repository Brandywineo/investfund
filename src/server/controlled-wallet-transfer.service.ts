import { and, eq, sql } from 'drizzle-orm'
import { isAddress } from 'ethers'
import { getDb } from '#/db'
import {
  auditLogs,
  controlledWalletTransfers,
  platformWallets,
} from '#/db/schema'
import { money } from '#/domain/money'
import {
  ensureTransferBalance,
  validateWalletTransferRoute,
} from '#/domain/wallet-transfer'

export const NATIVE_TRANSFER_FEE_ESTIMATE =
  process.env.ESTIMATED_NATIVE_TRANSFER_GAS_BNB ?? '0.00001'

export async function createControlledWalletTransfer(input: {
  sourceRole: 'HOT_WITHDRAWAL' | 'SWEEP_GAS'
  destinationType: 'INTERNAL' | 'EXTERNAL'
  destinationAddress?: string
  amount: string
  reason: string
  actorUserId: string
}) {
  return getDb().transaction(async (tx) => {
    const wallets = await tx.select().from(platformWallets)
    const source = wallets.find((wallet) => wallet.role === input.sourceRole)
    if (!source) throw new Error('Source platform wallet is not initialized')
    const destinationRole =
      input.destinationType === 'INTERNAL'
        ? input.sourceRole === 'SWEEP_GAS'
          ? ('HOT_WITHDRAWAL' as const)
          : ('SWEEP_GAS' as const)
        : null
    const internalDestination = destinationRole
      ? wallets.find((wallet) => wallet.role === destinationRole)
      : null
    const destinationAddress =
      internalDestination?.address ?? input.destinationAddress?.trim() ?? ''
    if (!isAddress(destinationAddress))
      throw new Error('Enter a valid BSC destination address')
    if (
      input.destinationType === 'EXTERNAL' &&
      wallets.some(
        (wallet) =>
          wallet.address.toLowerCase() === destinationAddress.toLowerCase(),
      )
    )
      throw new Error('Use an internal transfer for a platform wallet')

    validateWalletTransferRoute({
      sourceRole: input.sourceRole,
      destinationType: input.destinationType,
      destinationRole,
      asset: 'BNB',
    })
    ensureTransferBalance({
      asset: 'BNB',
      amount: input.amount,
      assetBalance: source.tokenBalance,
      nativeBalance: source.nativeBalance,
      estimatedFeeBnb: NATIVE_TRANSFER_FEE_ESTIMATE,
    })
    const transfer = await tx
      .insert(controlledWalletTransfers)
      .values({
        sourceRole: input.sourceRole,
        destinationType: input.destinationType,
        destinationRole,
        destinationAddress,
        asset: 'BNB',
        amount: money(input.amount).toString(),
        reason: input.reason,
        createdBy: input.actorUserId,
      })
      .returning()
      .then((rows) => rows.at(0))
    if (!transfer) throw new Error('Wallet transfer was not created')
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: 'CONTROLLED_WALLET_TRANSFER_DRAFTED',
      entityType: 'controlled_wallet_transfer',
      entityId: transfer.id,
      after: {
        sourceRole: transfer.sourceRole,
        destinationType: transfer.destinationType,
        destinationRole: transfer.destinationRole,
        destinationAddress: transfer.destinationAddress,
        asset: transfer.asset,
        amount: transfer.amount,
        reason: transfer.reason,
      },
    })
    return transfer
  })
}

export async function approveControlledWalletTransfer(
  transferId: string,
  actorUserId: string,
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select id from controlled_wallet_transfers where id = ${transferId} for update`,
    )
    const transfer = await tx
      .select()
      .from(controlledWalletTransfers)
      .where(eq(controlledWalletTransfers.id, transferId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!transfer || transfer.status !== 'DRAFTED')
      throw new Error('Draft wallet transfer not found')
    const source = await tx
      .select()
      .from(platformWallets)
      .where(eq(platformWallets.role, transfer.sourceRole))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!source) throw new Error('Source platform wallet is not initialized')
    ensureTransferBalance({
      asset: 'BNB',
      amount: transfer.amount,
      assetBalance: source.tokenBalance,
      nativeBalance: source.nativeBalance,
      estimatedFeeBnb: NATIVE_TRANSFER_FEE_ESTIMATE,
    })
    await tx
      .update(controlledWalletTransfers)
      .set({
        status: 'APPROVED',
        approvedBy: actorUserId,
        approvedAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(controlledWalletTransfers.id, transfer.id))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'CONTROLLED_WALLET_TRANSFER_APPROVED',
      entityType: 'controlled_wallet_transfer',
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: 'APPROVED' },
    })
    return transfer
  })
}

export async function cancelControlledWalletTransfer(
  transferId: string,
  actorUserId: string,
) {
  const result = await getDb()
    .update(controlledWalletTransfers)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(
      and(
        eq(controlledWalletTransfers.id, transferId),
        eq(controlledWalletTransfers.status, 'DRAFTED'),
      ),
    )
    .returning({ id: controlledWalletTransfers.id })
  if (result.length !== 1) throw new Error('Draft wallet transfer not found')
  await getDb()
    .insert(auditLogs)
    .values({
      actorUserId,
      action: 'CONTROLLED_WALLET_TRANSFER_CANCELLED',
      entityType: 'controlled_wallet_transfer',
      entityId: transferId,
      after: { status: 'CANCELLED' },
    })
}

export async function markControlledWalletTransferBroadcast(
  transferId: string,
  txHash: string,
) {
  const result = await getDb()
    .update(controlledWalletTransfers)
    .set({
      status: 'BROADCAST',
      txHash,
      broadcastAt: new Date(),
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(controlledWalletTransfers.id, transferId),
        eq(controlledWalletTransfers.status, 'PROCESSING'),
      ),
    )
    .returning({ id: controlledWalletTransfers.id })
  if (result.length !== 1)
    throw new Error('Processing wallet transfer not found')
}

export async function settleControlledWalletTransfer(
  transferId: string,
  success: boolean,
) {
  await getDb()
    .update(controlledWalletTransfers)
    .set({
      status: success ? 'CONFIRMED' : 'FAILED',
      confirmedAt: success ? new Date() : null,
      failureReason: success ? null : 'On-chain transaction reverted',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(controlledWalletTransfers.id, transferId),
        eq(controlledWalletTransfers.status, 'BROADCAST'),
      ),
    )
}
