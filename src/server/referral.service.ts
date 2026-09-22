import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/db'
import { referralCodes, referralRelationships } from '#/db/schema'

type TransactionExecutor = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReferralExecutor = Database | TransactionExecutor

function newCode() {
  return randomBytes(5).toString('hex').toUpperCase()
}

export async function ensureReferralCode(db: ReferralExecutor, userId: string) {
  const existing = await db
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.userId, userId))
    .limit(1)
    .then((rows) => rows.at(0))
  if (existing) return existing
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const created = await db
      .insert(referralCodes)
      .values({ userId, code: newCode() })
      .onConflictDoNothing()
      .returning()
      .then((rows) => rows.at(0))
    if (created) return created
    const concurrent = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.userId, userId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (concurrent) return concurrent
  }
  throw new Error('Could not generate a unique referral code')
}

export async function attachReferrer(
  tx: TransactionExecutor,
  referredUserId: string,
  rawCode: string,
) {
  const code = rawCode.trim().toUpperCase()
  const sponsor = await tx
    .select()
    .from(referralCodes)
    .where(sql`upper(${referralCodes.code}) = ${code}`)
    .limit(1)
    .then((rows) => rows.at(0))
  if (!sponsor) throw new Error('Referral code is invalid')
  if (sponsor.userId === referredUserId)
    throw new Error('You cannot refer your own account')
  await tx.insert(referralRelationships).values({
    referredUserId,
    referrerUserId: sponsor.userId,
    referralCodeId: sponsor.id,
  })
  return sponsor
}
