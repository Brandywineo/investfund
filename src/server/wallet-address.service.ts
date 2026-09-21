import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { walletAddresses } from '#/db/schema'
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

    const reservation = await tx
      .insert(walletAddresses)
      .values({
        userId,
        address: `pending:${crypto.randomUUID()}`,
        status: 'PAUSED',
      })
      .returning()
      .then((rows) => rows.at(0))
    if (!reservation) throw new Error('Could not reserve a wallet address')

    const derived = await deriveDepositAddress(reservation.derivationIndex)
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
