import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  accrualRates,
  dailyAccruals,
  investments,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  mt5Positions,
  notifications,
  platformSettings,
  referralCommissions,
  referralRelationships,
  withdrawals,
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
    const [
      investmentSummary,
      settings,
      rate,
      latestInvestment,
      openPositions,
      earnedProfit,
      referralIncome,
      pendingWithdrawal,
      unreadNotifications,
      recentActivityRows,
    ] = await Promise.all([
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
          isPublic: mt5Positions.isPublic,
          openedAt: mt5Positions.openedAt,
        })
        .from(mt5Positions)
        .orderBy(desc(mt5Positions.openedAt)),
      db
        .select({
          amount: sql<string>`coalesce(sum(${dailyAccruals.amount}), 0)`,
        })
        .from(dailyAccruals)
        .innerJoin(investments, eq(investments.id, dailyAccruals.investmentId))
        .where(eq(investments.userId, user.id))
        .then((rows) => rows.at(0)),
      db
        .select({
          amount: sql<string>`coalesce(sum(${referralCommissions.amount}), 0)`,
        })
        .from(referralCommissions)
        .where(eq(referralCommissions.beneficiaryUserId, user.id))
        .then((rows) => rows.at(0)),
      db
        .select({
          amount: sql<string>`coalesce(sum(${withdrawals.amount}), 0)`,
        })
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.userId, user.id),
            inArray(withdrawals.status, [
              'REQUESTED',
              'APPROVED',
              'PROCESSING',
              'BROADCAST',
            ]),
          ),
        )
        .then((rows) => rows.at(0)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
        )
        .then((rows) => rows.at(0)?.count ?? 0),
      db
        .select({
          transactionId: ledgerTransactions.id,
          eventType: ledgerTransactions.eventType,
          effectiveAt: ledgerTransactions.effectiveAt,
          accountCode: ledgerAccounts.code,
          debit: ledgerEntries.debit,
          credit: ledgerEntries.credit,
        })
        .from(ledgerEntries)
        .innerJoin(
          ledgerTransactions,
          eq(ledgerTransactions.id, ledgerEntries.transactionId),
        )
        .innerJoin(
          ledgerAccounts,
          eq(ledgerAccounts.id, ledgerEntries.accountId),
        )
        .where(eq(ledgerAccounts.ownerUserId, user.id))
        .orderBy(desc(ledgerTransactions.effectiveAt))
        .limit(12),
    ])
    const canViewLivePositions =
      user.role === 'ADMIN' || Boolean(latestInvestment)
    const visibleOpenPositions =
      user.role === 'ADMIN'
        ? openPositions
        : openPositions.filter((position) => position.isPublic)
    const latestPosition = canViewLivePositions
      ? (visibleOpenPositions.at(0) ?? null)
      : null
    const recentActivity = Array.from(
      recentActivityRows
        .reduce((items, row) => {
          const item = items.get(row.transactionId) ?? {
            id: row.transactionId,
            eventType: row.eventType,
            effectiveAt: row.effectiveAt.toISOString(),
            amount: '0',
          }
          const movement = money(row.credit).minus(row.debit)
          if (movement.abs().greaterThan(money(item.amount).abs()))
            item.amount = movement.toString()
          items.set(row.transactionId, item)
          return items
        }, new Map<string, { id: string; eventType: string; effectiveAt: string; amount: string }>())
        .values(),
    ).slice(0, 3)
    return {
      user,
      available: formatUsdt(available),
      investedLedgerBalance: formatUsdt(invested),
      activePrincipal: formatUsdt(investmentSummary?.principal ?? 0),
      activeInvestmentBalance: formatUsdt(investmentSummary?.balance ?? 0),
      earnedProfit: formatUsdt(earnedProfit?.amount ?? 0),
      referralIncome: formatUsdt(referralIncome?.amount ?? 0),
      pendingWithdrawal: formatUsdt(pendingWithdrawal?.amount ?? 0),
      unreadNotifications,
      recentActivity: recentActivity.map((item) => ({
        ...item,
        amount: formatUsdt(money(item.amount).abs()),
        direction: money(item.amount).isNegative() ? 'OUT' : 'IN',
      })),
      totalPortfolio: formatUsdt(
        money(available)
          .add(investmentSummary?.balance ?? 0)
          .add(pendingWithdrawal?.amount ?? 0),
      ),
      dailyRatePercent: rate?.dailyRatePercent ?? '0',
      minimumInvestment: settings?.minimumInvestment ?? '300',
      maximumInvestment: settings?.maximumInvestment ?? '5000',
      latestActivatedAt: latestInvestment
        ? latestInvestment.activatedAt.toISOString()
        : null,
      canViewLivePositions,
      openPositionCount: canViewLivePositions ? visibleOpenPositions.length : 0,
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
