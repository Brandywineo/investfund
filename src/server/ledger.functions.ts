import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  dailyAccruals,
  deposits,
  investments,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  referralCommissions,
  withdrawals,
} from '#/db/schema'
import { formatUsdt } from '#/domain/money'
import { getSessionUser } from './session'

export const getLedgerHistory = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await getSessionUser()
    if (!user) throw new Error('Authentication required')
    const db = getDb()
    const ownedAccounts = await db
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.ownerUserId, user.id))
    const accountIds = ownedAccounts.map((account) => account.id)
    if (accountIds.length === 0)
      return {
        transactions: [],
        summary: {
          deposited: '0.00',
          investmentProfit: '0.00',
          referralIncome: '0.00',
          withdrawn: '0.00',
          withdrawalFees: '0.00',
        },
      }

    const [rows, deposited, investmentProfit, referralIncome, withdrawal] =
      await Promise.all([
        db
          .select({
            transactionId: ledgerTransactions.id,
            eventType: ledgerTransactions.eventType,
            description: ledgerTransactions.description,
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
          .where(inArray(ledgerEntries.accountId, accountIds))
          .orderBy(desc(ledgerTransactions.effectiveAt))
          .limit(200),
        db
          .select({ amount: sql<string>`coalesce(sum(${deposits.amount}), 0)` })
          .from(deposits)
          .where(
            and(eq(deposits.userId, user.id), eq(deposits.status, 'CONFIRMED')),
          )
          .then((items) => items.at(0)?.amount ?? '0'),
        db
          .select({
            amount: sql<string>`coalesce(sum(${dailyAccruals.amount}), 0)`,
          })
          .from(dailyAccruals)
          .innerJoin(
            investments,
            eq(investments.id, dailyAccruals.investmentId),
          )
          .where(eq(investments.userId, user.id))
          .then((items) => items.at(0)?.amount ?? '0'),
        db
          .select({
            amount: sql<string>`coalesce(sum(${referralCommissions.amount}), 0)`,
          })
          .from(referralCommissions)
          .where(eq(referralCommissions.beneficiaryUserId, user.id))
          .then((items) => items.at(0)?.amount ?? '0'),
        db
          .select({
            amount: sql<string>`coalesce(sum(${withdrawals.netAmount}), 0)`,
            fees: sql<string>`coalesce(sum(${withdrawals.feeAmount}), 0)`,
          })
          .from(withdrawals)
          .where(
            and(
              eq(withdrawals.userId, user.id),
              eq(withdrawals.status, 'CONFIRMED'),
            ),
          )
          .then((items) => items.at(0) ?? { amount: '0', fees: '0' }),
      ])

    const transactions = new Map<
      string,
      {
        id: string
        eventType: string
        description: string
        effectiveAt: string
        lines: Array<{ account: string; debit: string; credit: string }>
      }
    >()
    for (const row of rows) {
      const transaction = transactions.get(row.transactionId) ?? {
        id: row.transactionId,
        eventType: row.eventType,
        description: row.description,
        effectiveAt: row.effectiveAt.toISOString(),
        lines: [],
      }
      transaction.lines.push({
        account: row.accountCode.split(':').at(-1) ?? row.accountCode,
        debit: row.debit,
        credit: row.credit,
      })
      transactions.set(row.transactionId, transaction)
    }
    return {
      transactions: [...transactions.values()],
      summary: {
        deposited: formatUsdt(deposited),
        investmentProfit: formatUsdt(investmentProfit),
        referralIncome: formatUsdt(referralIncome),
        withdrawn: formatUsdt(withdrawal.amount),
        withdrawalFees: formatUsdt(withdrawal.fees),
      },
    }
  },
)
