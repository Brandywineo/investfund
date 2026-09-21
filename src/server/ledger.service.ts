import { and, eq, gte, lte, or, isNull, desc } from 'drizzle-orm'
import type { Database } from '#/db'
import { getDb } from '#/db'
import {
  accrualRates,
  dailyAccruals,
  investments,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  platformSettings,
} from '#/db/schema'
import { calculateDailyAccrual, accrualIdempotencyKey, validateInvestmentAmount } from '#/domain/accrual'
import { assertBalanced } from '#/domain/ledger'
import type { LedgerLine } from '#/domain/ledger'

interface PostTransactionInput {
  eventType: string
  referenceType: string
  referenceId?: string
  idempotencyKey: string
  description: string
  effectiveAt: Date
  createdBy?: string
  lines: Array<LedgerLine>
}

type TransactionExecutor = Parameters<Parameters<Database['transaction']>[0]>[0]
type LedgerExecutor = Database | TransactionExecutor

export async function postLedgerTransaction(db: LedgerExecutor, input: PostTransactionInput) {
  assertBalanced(input.lines)
  const transaction = (await db
    .insert(ledgerTransactions)
    .values({
      eventType: input.eventType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      effectiveAt: input.effectiveAt,
      createdBy: input.createdBy,
    })
    .returning({ id: ledgerTransactions.id })).at(0)
  if (!transaction) throw new Error('Ledger transaction was not created')

  await db.insert(ledgerEntries).values(
    input.lines.map((line, index) => ({
      transactionId: transaction.id,
      lineNumber: index + 1,
      accountId: line.accountId,
      debit: line.side === 'DEBIT' ? String(line.amount) : '0',
      credit: line.side === 'CREDIT' ? String(line.amount) : '0',
    })),
  )
  return transaction
}

async function requireAccount(db: LedgerExecutor, code: string) {
  const account = (await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.code, code))
    .limit(1)).at(0)
  if (!account) throw new Error(`Required ledger account is missing: ${code}`)
  return account.id
}

export async function createInvestment(userId: string, rawAmount: string, requestId: string) {
  return getDb().transaction(async (tx) => {
    const settings = (await tx.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1)).at(0)
    if (!settings) throw new Error('Platform settings are not initialized')
    const amount = validateInvestmentAmount(rawAmount, settings.minimumInvestment, settings.maximumInvestment)

    const investment = (await tx
      .insert(investments)
      .values({ userId, principal: amount.toString(), compoundedBalance: amount.toString(), activatedAt: new Date() })
      .returning({ id: investments.id })).at(0)
    if (!investment) throw new Error('Investment was not created')

    const available = await requireAccount(tx, `USER:${userId}:AVAILABLE`)
    const invested = await requireAccount(tx, `USER:${userId}:INVESTED`)
    await postLedgerTransaction(tx, {
      eventType: 'INVESTMENT_ACTIVATED', referenceType: 'investment', referenceId: investment.id,
      idempotencyKey: `investment:${requestId}`, description: 'Move available balance into active investment',
      effectiveAt: new Date(), createdBy: userId,
      lines: [{ accountId: available, side: 'DEBIT', amount }, { accountId: invested, side: 'CREDIT', amount }],
    })
    return investment
  })
}

export async function postDailyAccrual(investmentId: string, accrualDate: Date) {
  return getDb().transaction(async (tx) => {
    const investment = (await tx.select().from(investments).where(and(eq(investments.id, investmentId), eq(investments.status, 'ACTIVE'))).limit(1)).at(0)
    if (!investment) throw new Error('Active investment not found')
    const rate = (await tx.select().from(accrualRates).where(and(lte(accrualRates.effectiveFrom, accrualDate), or(isNull(accrualRates.effectiveUntil), gte(accrualRates.effectiveUntil, accrualDate)))).orderBy(desc(accrualRates.effectiveFrom)).limit(1)).at(0)
    if (!rate) throw new Error('No effective daily rate exists')

    const result = calculateDailyAccrual(investment.compoundedBalance, rate.dailyRatePercent)
    const expense = await requireAccount(tx, 'PLATFORM:ACCRUAL_EXPENSE')
    const invested = await requireAccount(tx, `USER:${investment.userId}:INVESTED`)
    const transaction = await postLedgerTransaction(tx, {
      eventType: 'DAILY_ACCRUAL', referenceType: 'investment', referenceId: investment.id,
      idempotencyKey: accrualIdempotencyKey(investment.id, accrualDate.toISOString()),
      description: 'Daily investment accrual', effectiveAt: accrualDate,
      lines: [{ accountId: expense, side: 'DEBIT', amount: result.amount }, { accountId: invested, side: 'CREDIT', amount: result.amount }],
    })
    await tx.insert(dailyAccruals).values({ investmentId, accrualDate, openingBalance: result.openingBalance.toString(), ratePercent: result.ratePercent.toString(), amount: result.amount.toString(), closingBalance: result.closingBalance.toString(), ledgerTransactionId: transaction.id })
    await tx.update(investments).set({ compoundedBalance: result.closingBalance.toString(), lastAccruedOn: accrualDate, updatedAt: new Date() }).where(eq(investments.id, investmentId))
    return result
  })
}
