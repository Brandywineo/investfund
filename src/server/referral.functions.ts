import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '#/db'
import {
  referralCodes,
  referralCommissions,
  referralRelationships,
  users,
} from '#/db/schema'
import { formatUsdt } from '#/domain/money'
import { REFERRAL_RATES } from '#/domain/referral'
import { getSessionUser } from './session'
import { ensureReferralCode } from './referral.service'

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

export const getReferralDashboard = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const db = getDb()
    const code = await ensureReferralCode(db, user.id)
    const sourceUser = alias(users, 'source_user')
    const [sponsor, directs, commissions, totals] = await Promise.all([
      db
        .select({ displayName: users.displayName, email: users.email })
        .from(referralRelationships)
        .innerJoin(users, eq(users.id, referralRelationships.referrerUserId))
        .where(eq(referralRelationships.referredUserId, user.id))
        .limit(1)
        .then((rows) => rows.at(0) ?? null),
      db
        .select({
          displayName: users.displayName,
          email: users.email,
          joinedAt: referralRelationships.createdAt,
        })
        .from(referralRelationships)
        .innerJoin(users, eq(users.id, referralRelationships.referredUserId))
        .where(eq(referralRelationships.referrerUserId, user.id))
        .orderBy(desc(referralRelationships.createdAt)),
      db
        .select({
          id: referralCommissions.id,
          level: referralCommissions.level,
          ratePercent: referralCommissions.ratePercent,
          sourceProfit: referralCommissions.sourceProfit,
          amount: referralCommissions.amount,
          sourceName: sourceUser.displayName,
          createdAt: referralCommissions.createdAt,
        })
        .from(referralCommissions)
        .innerJoin(
          sourceUser,
          eq(sourceUser.id, referralCommissions.sourceUserId),
        )
        .where(eq(referralCommissions.beneficiaryUserId, user.id))
        .orderBy(desc(referralCommissions.createdAt))
        .limit(100),
      db
        .select({
          level: referralCommissions.level,
          amount: sql<string>`coalesce(sum(${referralCommissions.amount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(referralCommissions)
        .where(eq(referralCommissions.beneficiaryUserId, user.id))
        .groupBy(referralCommissions.level),
    ])
    const totalsByLevel = Object.fromEntries(
      totals.map((item) => [item.level, formatUsdt(item.amount)]),
    )
    return {
      code: code.code,
      sponsor,
      directReferrals: directs,
      commissions,
      rates: REFERRAL_RATES,
      summary: {
        total: formatUsdt(
          totals.reduce((sum, item) => sum + Number(item.amount), 0),
        ),
        level1: totalsByLevel[1] ?? '0.00',
        level2: totalsByLevel[2] ?? '0.00',
        level3: totalsByLevel[3] ?? '0.00',
      },
    }
  },
)

export const getReferralAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    const admin = await requireUser()
    if (admin.role !== 'ADMIN') throw new Error('Administrator access required')
    const referred = alias(users, 'referred_user')
    const referrer = alias(users, 'referrer_user')
    const relationships = await getDb()
      .select({
        referredName: referred.displayName,
        referredEmail: referred.email,
        referrerName: referrer.displayName,
        referrerEmail: referrer.email,
        code: referralCodes.code,
        createdAt: referralRelationships.createdAt,
      })
      .from(referralRelationships)
      .innerJoin(
        referred,
        eq(referred.id, referralRelationships.referredUserId),
      )
      .innerJoin(
        referrer,
        eq(referrer.id, referralRelationships.referrerUserId),
      )
      .innerJoin(
        referralCodes,
        eq(referralCodes.id, referralRelationships.referralCodeId),
      )
      .orderBy(desc(referralRelationships.createdAt))
      .limit(500)
    const totals = await getDb()
      .select({
        level: referralCommissions.level,
        amount: sql<string>`coalesce(sum(${referralCommissions.amount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(referralCommissions)
      .groupBy(referralCommissions.level)
    return { relationships, totals, rates: REFERRAL_RATES }
  },
)
