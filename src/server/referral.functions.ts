import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '#/db'
import {
  referralCodes,
  referralCommissions,
  referralRelationships,
  deposits,
  investments,
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
    const [sponsor, directRows, commissions, totals, relationships] =
      await Promise.all([
        db
          .select({ displayName: users.displayName, email: users.email })
          .from(referralRelationships)
          .innerJoin(users, eq(users.id, referralRelationships.referrerUserId))
          .where(eq(referralRelationships.referredUserId, user.id))
          .limit(1)
          .then((rows) => rows.at(0) ?? null),
        db
          .select({
            id: users.id,
            displayName: users.displayName,
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
        db
          .select({
            referrerUserId: referralRelationships.referrerUserId,
            referredUserId: referralRelationships.referredUserId,
          })
          .from(referralRelationships),
      ])
    const level1Ids = directRows.map((item) => item.id)
    const level2Ids = relationships
      .filter((item) => level1Ids.includes(item.referrerUserId))
      .map((item) => item.referredUserId)
    const level3Ids = relationships
      .filter((item) => level2Ids.includes(item.referrerUserId))
      .map((item) => item.referredUserId)
    const networkIds = [...new Set([...level1Ids, ...level2Ids, ...level3Ids])]
    const [activeRows, fundedRows, directEarnings] = await Promise.all([
      networkIds.length
        ? db
            .select({ userId: investments.userId })
            .from(investments)
            .where(
              and(
                inArray(investments.userId, networkIds),
                eq(investments.status, 'ACTIVE'),
              ),
            )
            .groupBy(investments.userId)
        : Promise.resolve([]),
      level1Ids.length
        ? db
            .select({ userId: deposits.userId })
            .from(deposits)
            .where(
              and(
                inArray(deposits.userId, level1Ids),
                eq(deposits.status, 'CONFIRMED'),
              ),
            )
            .groupBy(deposits.userId)
        : Promise.resolve([]),
      level1Ids.length
        ? db
            .select({
              userId: referralCommissions.sourceUserId,
              amount: sql<string>`coalesce(sum(${referralCommissions.amount}), 0)`,
            })
            .from(referralCommissions)
            .where(
              and(
                eq(referralCommissions.beneficiaryUserId, user.id),
                eq(referralCommissions.level, 1),
                inArray(referralCommissions.sourceUserId, level1Ids),
              ),
            )
            .groupBy(referralCommissions.sourceUserId)
        : Promise.resolve([]),
    ])
    const activeIds = new Set(activeRows.map((item) => item.userId))
    const fundedIds = new Set(fundedRows.map((item) => item.userId))
    const earningsByUser = new Map(
      directEarnings.map((item) => [item.userId, formatUsdt(item.amount)]),
    )
    const directs = directRows.map((item) => ({
      displayName: item.displayName,
      joinedAt: item.joinedAt,
      status: activeIds.has(item.id)
        ? 'investing'
        : fundedIds.has(item.id)
          ? 'funded'
          : 'registered',
      earnings: earningsByUser.get(item.id) ?? '0.00',
    }))
    const totalsByLevel = new Map(
      totals.map((item) => [item.level, formatUsdt(item.amount)]),
    )
    return {
      code: code.code,
      sponsor,
      directReferrals: directs,
      networkStats: [
        {
          level: 2,
          members: level2Ids.length,
          investing: level2Ids.filter((id) => activeIds.has(id)).length,
          earnings: totalsByLevel.get(2) ?? '0.00',
        },
        {
          level: 3,
          members: level3Ids.length,
          investing: level3Ids.filter((id) => activeIds.has(id)).length,
          earnings: totalsByLevel.get(3) ?? '0.00',
        },
      ],
      commissions,
      rates: REFERRAL_RATES,
      summary: {
        total: formatUsdt(
          totals.reduce((sum, item) => sum + Number(item.amount), 0),
        ),
        level1: totalsByLevel.get(1) ?? '0.00',
        level2: totalsByLevel.get(2) ?? '0.00',
        level3: totalsByLevel.get(3) ?? '0.00',
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
