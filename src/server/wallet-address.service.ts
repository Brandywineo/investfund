import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { walletAddresses, walletSets } from '#/db/schema'
import { deriveDepositAddress } from './signer-api'

export async function getOrCreateWalletAddress(userId: string) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    const existing = await tx
      .select()
      .from(walletAddresses)
      .where(
        and(
          eq(walletAddresses.userId, userId),
          eq(walletAddresses.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (existing) return existing

    const activeSet = await tx
      .select()
      .from(walletSets)
      .where(eq(walletSets.status, 'ACTIVE'))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!activeSet) throw new Error('No active wallet set is configured')

    const reservation = await tx
      .insert(walletAddresses)
      .values({
        userId,
        walletSetId: activeSet.id,
        address: `pending:${crypto.randomUUID()}`,
        status: 'PAUSED',
      })
      .returning()
      .then((rows) => rows.at(0))
    if (!reservation) throw new Error('Could not reserve a wallet address')

    const derived = await deriveDepositAddress(
      reservation.derivationIndex,
      activeSet.signerKey,
    )
    return tx
      .update(walletAddresses)
      .set({
        address: derived.address,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(eq(walletAddresses.id, reservation.id))
      .returning()
      .then((rows) => rows.at(0))
  })
}

export async function rotateUserWalletAddress(
  userId: string,
  targetWalletSetId: string,
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    const target = await tx
      .select()
      .from(walletSets)
      .where(
        and(
          eq(walletSets.id, targetWalletSetId),
          eq(walletSets.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (!target) throw new Error('The selected wallet set is not active')
    const current = await tx
      .select()
      .from(walletAddresses)
      .where(
        and(
          eq(walletAddresses.userId, userId),
          eq(walletAddresses.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (current?.walletSetId === target.id)
      throw new Error('User already uses the active wallet set')

    if (current) {
      await tx
        .update(walletAddresses)
        .set({ status: 'ROTATED', updatedAt: new Date() })
        .where(eq(walletAddresses.id, current.id))
    }
    const reservation = await tx
      .insert(walletAddresses)
      .values({
        userId,
        walletSetId: target.id,
        address: `pending:${crypto.randomUUID()}`,
        status: 'PAUSED',
      })
      .returning()
      .then((rows) => rows.at(0))
    if (!reservation) throw new Error('Could not reserve a wallet address')
    const derived = await deriveDepositAddress(
      reservation.derivationIndex,
      target.signerKey,
    )
    return tx
      .update(walletAddresses)
      .set({
        address: derived.address,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(eq(walletAddresses.id, reservation.id))
      .returning()
      .then((rows) => rows.at(0))
  })
}
