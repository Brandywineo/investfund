import { createServerFn } from '@tanstack/react-start'
import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { hasSufficientHotGas } from '#/domain/chain-worker'
import {
  controlledWalletTransfers,
  platformWallets,
  treasuryTransfers,
  treasuryTransactionAttempts,
} from '#/db/schema'
import {
  approveControlledWalletTransfer,
  cancelControlledWalletTransfer,
  createControlledWalletTransfer,
  NATIVE_TRANSFER_FEE_ESTIMATE,
} from './controlled-wallet-transfer.service'
import { requestTreasuryGasReplacement } from './signer-api'
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
  const [wallets, transfers, usdtTransfers, treasuryAttempts] =
    await Promise.all([
      getDb().select().from(platformWallets),
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
    ])
  return {
    wallets,
    transfers,
    usdtTransfers: usdtTransfers.filter(
      (transfer) => transfer.direction === 'OUTBOUND',
    ),
    treasuryAttempts,
    estimatedNativeFeeBnb: NATIVE_TRANSFER_FEE_ESTIMATE,
    recommendedSweepReserveBnb:
      process.env.RECOMMENDED_SWEEP_GAS_RESERVE_BNB ?? '0.001',
    hotWalletHasGas: hasSufficientHotGas(
      wallets.find((wallet) => wallet.role === 'HOT_WITHDRAWAL')
        ?.nativeBalance ?? '0',
      process.env.MIN_HOT_GAS_BNB ?? '0.00002',
    ),
  }
})

export const draftControlledWalletTransfer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      sourceRole: z.enum(['HOT_WITHDRAWAL', 'SWEEP_GAS']),
      destinationType: z.enum(['INTERNAL', 'EXTERNAL']),
      destinationAddress: z.string().trim().max(160).optional(),
      amount: amountSchema,
      reason: z.string().trim().min(3).max(250),
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
