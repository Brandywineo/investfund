import { createServerFn } from '@tanstack/react-start'
import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  controlledWalletTransfers,
  depositGasRecoveries,
  platformWallets,
  treasuryTransfers,
  treasuryTransactionAttempts,
  walletAddresses,
  walletSets,
} from '#/db/schema'
import {
  approveControlledWalletTransfer,
  cancelControlledWalletTransfer,
  createControlledWalletTransfer,
  NATIVE_TRANSFER_FEE_ESTIMATE,
} from './controlled-wallet-transfer.service'
import { requestTreasuryGasReplacement } from './signer-api'
import {
  getDepositGasRecoveryPreview,
  queueDepositGasRecovery,
} from './deposit-gas-recovery.service'
import { getSessionUser } from './session'

const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,18})?$/)
  .refine((value) => Number(value) > 0, 'Amount must be positive')

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

export const getControlledWalletTransferDashboard = createServerFn({
  method: 'GET',
}).handler(async () => {
  await requireAdmin()
  const [
    wallets,
    sets,
    transfers,
    legacyTransfers,
    treasuryAttempts,
    gasPreview,
    gasRecoveries,
    addresses,
  ] = await Promise.all([
    getDb().select().from(platformWallets),
    getDb().select().from(walletSets),
    getDb()
      .select()
      .from(controlledWalletTransfers)
      .orderBy(desc(controlledWalletTransfers.createdAt))
      .limit(100),
    getDb()
      .select()
      .from(treasuryTransfers)
      .orderBy(desc(treasuryTransfers.createdAt))
      .limit(100),
    getDb()
      .select()
      .from(treasuryTransactionAttempts)
      .orderBy(desc(treasuryTransactionAttempts.createdAt))
      .limit(200),
    getDepositGasRecoveryPreview(),
    getDb()
      .select()
      .from(depositGasRecoveries)
      .orderBy(desc(depositGasRecoveries.createdAt))
      .limit(100),
    getDb().select().from(walletAddresses),
  ])
  return {
    wallets,
    walletSets: sets,
    transfers,
    legacyTransfers: legacyTransfers.filter(
      (transfer) => transfer.direction === 'OUTBOUND',
    ),
    treasuryAttempts,
    gasPreview,
    gasRecoveries,
    walletAddresses: addresses,
    estimatedNativeFeeBnb: NATIVE_TRANSFER_FEE_ESTIMATE,
    recommendedSweepReserveBnb:
      process.env.RECOMMENDED_SWEEP_GAS_RESERVE_BNB ?? '0.001',
    minimumHotGasBnb: process.env.MIN_HOT_GAS_BNB ?? '0.00002',
  }
})

export const draftControlledWalletTransfer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      sourcePlatformWalletId: z.string().uuid(),
      destinationType: z.enum(['INTERNAL', 'EXTERNAL']),
      destinationPlatformWalletId: z.string().uuid().optional(),
      destinationAddress: z.string().trim().max(160).optional(),
      asset: z.enum(['BNB', 'USDT']),
      amount: amountSchema,
      reason: z.string().trim().min(3).max(250),
      purpose: z
        .enum([
          'WALLET_REBALANCING',
          'MT5_CAPITAL',
          'ADMIN_RESERVE',
          'WITHDRAWAL_LIQUIDITY',
          'OPERATIONS',
          'OTHER',
        ])
        .default('WALLET_REBALANCING'),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const transfer = await createControlledWalletTransfer({
      ...data,
      actorUserId: admin.id,
    })
    return { success: true, transferId: transfer.id }
  })

export const queueDepositGasRecoveryAction = createServerFn({ method: 'POST' })
  .validator(z.object({ walletSetId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    return queueDepositGasRecovery({
      walletSetId: data.walletSetId,
      actorUserId: admin.id,
    })
  })

export const reviewControlledWalletTransfer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      transferId: z.string().uuid(),
      action: z.enum(['APPROVE', 'CANCEL']),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (data.action === 'APPROVE')
      await approveControlledWalletTransfer(data.transferId, admin.id)
    else await cancelControlledWalletTransfer(data.transferId, admin.id)
    return { success: true }
  })

export const replaceStuckTreasuryTransfer = createServerFn({ method: 'POST' })
  .validator(z.object({ transferId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const result = await requestTreasuryGasReplacement(data.transferId)
    return { success: true, txHash: result.txHash }
  })
