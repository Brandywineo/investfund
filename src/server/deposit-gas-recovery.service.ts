import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  auditLogs,
  depositGasRecoveries,
  platformWallets,
  walletAddresses,
  walletSets,
} from '#/db/schema'
import { money } from '#/domain/money'

export const DUST_RECOVERY_MIN_BNB =
  process.env.BNB_DUST_RECOVERY_MIN ?? '0.000001'
export const DUST_RECOVERY_FEE_ESTIMATE_BNB =
  process.env.BNB_DUST_RECOVERY_FEE_ESTIMATE ?? '0.000001'

export async function getDepositGasRecoveryPreview() {
  const db = getDb()
  const [addresses, sets, destinations, active] = await Promise.all([
    db
      .select()
      .from(walletAddresses)
      .where(inArray(walletAddresses.status, ['ACTIVE', 'ROTATED'])),
    db.select().from(walletSets),
    db
      .select()
      .from(platformWallets)
      .where(eq(platformWallets.role, 'SWEEP_GAS')),
    db
      .select({ walletAddressId: depositGasRecoveries.walletAddressId })
      .from(depositGasRecoveries)
      .where(
        inArray(depositGasRecoveries.status, [
          'APPROVED',
          'PROCESSING',
          'BROADCAST',
        ]),
      ),
  ])
  const activeIds = new Set(active.map((row) => row.walletAddressId))
  const fee = money(DUST_RECOVERY_FEE_ESTIMATE_BNB)
  const minimum = money(DUST_RECOVERY_MIN_BNB)
  return sets.map((set) => {
    const destination = destinations.find(
      (wallet) => wallet.walletSetId === set.id,
    )
    const candidates = addresses.filter((address) => {
      const recoverable = money(address.nativeBalance).minus(fee)
      return (
        address.walletSetId === set.id &&
        !activeIds.has(address.id) &&
        recoverable.greaterThanOrEqualTo(minimum)
      )
    })
    const totalBalance = candidates.reduce(
      (sum, address) => sum.add(address.nativeBalance),
      money(0),
    )
    const estimatedFees = fee.mul(candidates.length)
    return {
      walletSetId: set.id,
      walletSetName: set.name,
      walletSetStatus: set.status,
      destinationPlatformWalletId: destination?.id ?? null,
      destinationAddress: destination?.address ?? null,
      addressCount: candidates.length,
      totalBalance: totalBalance.toString(),
      estimatedFees: estimatedFees.toString(),
      estimatedRecovery: totalBalance.minus(estimatedFees).toString(),
    }
  })
}

export async function queueDepositGasRecovery(input: {
  walletSetId?: string
  actorUserId: string
}) {
  return getDb().transaction(async (tx) => {
    const addresses = await tx
      .select()
      .from(walletAddresses)
      .where(
        input.walletSetId
          ? and(
              eq(walletAddresses.walletSetId, input.walletSetId),
              inArray(walletAddresses.status, ['ACTIVE', 'ROTATED']),
            )
          : inArray(walletAddresses.status, ['ACTIVE', 'ROTATED']),
      )
    const destinations = await tx
      .select()
      .from(platformWallets)
      .where(eq(platformWallets.role, 'SWEEP_GAS'))
    const active = await tx
      .select({ walletAddressId: depositGasRecoveries.walletAddressId })
      .from(depositGasRecoveries)
      .where(
        inArray(depositGasRecoveries.status, [
          'APPROVED',
          'PROCESSING',
          'BROADCAST',
        ]),
      )
    const activeIds = new Set(active.map((row) => row.walletAddressId))
    const fee = money(DUST_RECOVERY_FEE_ESTIMATE_BNB)
    const minimum = money(DUST_RECOVERY_MIN_BNB)
    const rows = addresses.flatMap((address) => {
      const destination = destinations.find(
        (wallet) => wallet.walletSetId === address.walletSetId,
      )
      const recoverable = money(address.nativeBalance).minus(fee)
      if (
        !destination ||
        activeIds.has(address.id) ||
        !recoverable.greaterThanOrEqualTo(minimum)
      )
        return []
      return [
        {
          walletAddressId: address.id,
          destinationPlatformWalletId: destination.id,
          requestedBy: input.actorUserId,
        },
      ]
    })
    if (!rows.length)
      throw new Error('No deposit addresses have recoverable BNB')
    const queued = await tx
      .insert(depositGasRecoveries)
      .values(rows)
      .returning({ id: depositGasRecoveries.id })
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: 'DEPOSIT_GAS_RECOVERY_QUEUED',
      entityType: 'wallet_set',
      entityId: input.walletSetId ?? null,
      after: { count: queued.length, walletSetId: input.walletSetId ?? 'ALL' },
    })
    return { count: queued.length }
  })
}
