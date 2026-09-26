import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  accrualRates,
  investments,
  ledgerAccounts,
  ledgerEntries,
  mt5Positions,
  platformSettings,
  referralRelationships,
} from '#/db/schema'
import { formatUsdt, money } from '#/domain/money'
import { createInvestment } from './ledger.service'
import { notifyUser } from './notification.service'
import { getSessionUser } from './session'

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

export const getPortfolio = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const db = getDb()
    const accountBalances = await db
      .select({
        code: ledgerAccounts.code,
        balance: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`,
      })
      .from(ledgerAccounts)
      .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
      .where(eq(ledgerAccounts.ownerUserId, user.id))
      .groupBy(ledgerAccounts.code)
    const balances = Object.fromEntries(
      accountBalances.map((item) => [item.code, item.balance]),
    )
    const available = balances[`USER:${user.id}:AVAILABLE`] ?? '0'
    const invested = balances[`USER:${user.id}:INVESTED`] ?? '0'
    const [investmentSummary, settings, rate, latestInvestment, openPositions] =
      await Promise.all([
        db
          .select({
            principal: sql<string>`coalesce(sum(${investments.principal}), 0)`,
            balance: sql<string>`coalesce(sum(${investments.compoundedBalance}), 0)`,
          })
          .from(investments)
          .where(
            and(
              eq(investments.userId, user.id),
              eq(investments.status, 'ACTIVE'),
            ),
          )
          .then((rows) => rows.at(0)),
        db
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.id, 1))
          .limit(1)
          .then((rows) => rows.at(0)),
        db
          .select({ dailyRatePercent: accrualRates.dailyRatePercent })
          .from(accrualRates)
          .where(
            and(
              lte(accrualRates.effectiveFrom, new Date()),
              or(
                isNull(accrualRates.effectiveUntil),
                gte(accrualRates.effectiveUntil, new Date()),
              ),
            ),
          )
          .orderBy(desc(accrualRates.effectiveFrom))
          .limit(1)
          .then((rows) => rows.at(0)),
        db
          .select({ activatedAt: investments.activatedAt })
          .from(investments)
          .where(
            and(
              eq(investments.userId, user.id),
              eq(investments.status, 'ACTIVE'),
            ),
          )
          .orderBy(desc(investments.activatedAt))
          .limit(1)
          .then((rows) => rows.at(0)),
        db
          .select({
            ticket: mt5Positions.ticket,
            symbol: mt5Positions.symbol,
            side: mt5Positions.side,
            volume: mt5Positions.volume,
            entryPrice: mt5Positions.entryPrice,
            currentPrice: mt5Positions.currentPrice,
            floatingProfit: mt5Positions.floatingProfit,
            openedAt: mt5Positions.openedAt,
          })
          .from(mt5Positions)
          .orderBy(desc(mt5Positions.openedAt)),
      ])
    const canViewLivePositions =
      user.role === 'ADMIN' || Boolean(latestInvestment)
    const latestPosition = canViewLivePositions
      ? (openPositions.at(0) ?? null)
      : null
    return {
      user,
      available: formatUsdt(available),
      investedLedgerBalance: formatUsdt(invested),
      activePrincipal: formatUsdt(investmentSummary?.principal ?? 0),
      activeInvestmentBalance: formatUsdt(investmentSummary?.balance ?? 0),
      totalPortfolio: formatUsdt(
        money(available).add(investmentSummary?.balance ?? 0),
      ),
      dailyRatePercent: rate?.dailyRatePercent ?? '0',
      minimumInvestment: settings?.minimumInvestment ?? '300',
      maximumInvestment: settings?.maximumInvestment ?? '5000',
      latestActivatedAt: latestInvestment
        ? latestInvestment.activatedAt.toISOString()
        : null,
      canViewLivePositions,
      openPositionCount: canViewLivePositions ? openPositions.length : 0,
      latestPosition: latestPosition
        ? {
            ...latestPosition,
            openedAt: latestPosition.openedAt.toISOString(),
          }
        : null,
    }
  },
)

export const activateInvestment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      amount: z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,8})?$/),
      requestId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const investment = await createInvestment(
      user.id,
      data.amount,
      data.requestId,
    )
    const sponsor = await getDb()
      .select({ userId: referralRelationships.referrerUserId })
      .from(referralRelationships)
      .where(eq(referralRelationships.referredUserId, user.id))
      .limit(1)
      .then((rows) => rows.at(0))
    if (sponsor)
      await Promise.allSettled([
        notifyUser({
          userId: sponsor.userId,
          category: 'REFERRAL',
          title: 'Direct referral started investing',
          body: 'Your direct referral is now active. Commission will be credited when their daily profit is posted.',
          href: '/referrals',
          eventKey: `referral:${user.id}:investment-activated`,
        }),
      ])
    return { success: true, investmentId: investment.id }
  })
