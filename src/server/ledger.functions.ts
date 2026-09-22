import { createServerFn } from '@tanstack/react-start'
import { desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '#/db'
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from '#/db/schema'
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
    if (accountIds.length === 0) return []

    const rows = await db
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
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(inArray(ledgerEntries.accountId, accountIds))
      .orderBy(desc(ledgerTransactions.effectiveAt))
      .limit(200)

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
    return [...transactions.values()]
  },
)
