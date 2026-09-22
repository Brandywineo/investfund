import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  investmentExitRequests,
  investments,
  ledgerAccounts,
  ledgerEntries,
  platformSettings,
  users,
} from '#/db/schema'
import { formatUsdt, money } from '#/domain/money'
import { postLedgerTransaction } from './ledger.service'
import { notifyUser } from './notification.service'
import { getSessionUser } from './session'

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== 'ADMIN') throw new Error('Administrator access required')
  return user
}

async function account(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  code: string,
) {
  const row = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.code, code))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!row) throw new Error(`Required ledger account is missing: ${code}`)
  return row.id
}

export const getInvestmentManagement = createServerFn({
  method: 'GET',
}).handler(async () => {
  const user = await requireUser()
  const [investmentRows, exitRows] = await Promise.all([
    getDb()
      .select()
      .from(investments)
      .where(eq(investments.userId, user.id))
      .orderBy(desc(investments.createdAt)),
    getDb()
      .select()
      .from(investmentExitRequests)
      .where(eq(investmentExitRequests.userId, user.id))
      .orderBy(desc(investmentExitRequests.createdAt)),
  ])
  const activeExitByInvestment = new Map(
    exitRows
      .filter((item) => ['REQUESTED', 'DEFERRED'].includes(item.status))
      .map((item) => [item.investmentId, item]),
  )
  return {
    investments: investmentRows.map((item) => ({
      ...item,
      principalDisplay: formatUsdt(item.principal),
      balanceDisplay: formatUsdt(item.compoundedBalance),
      releasableProfit: formatUsdt(
        Math.max(
          0,
          money(item.compoundedBalance).minus(item.principal).toNumber(),
        ),
      ),
      exitRequest: activeExitByInvestment.get(item.id) ?? null,
    })),
    exitHistory: exitRows,
  }
})

export const releaseInvestmentProfit = createServerFn({ method: 'POST' })
  .validator(z.object({ investmentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select id from investments where id = ${data.investmentId} for update`,
      )
      const investment = await tx
        .select()
        .from(investments)
        .where(
          and(
            eq(investments.id, data.investmentId),
            eq(investments.userId, user.id),
            eq(investments.status, 'ACTIVE'),
          ),
        )
        .limit(1)
        .then((rows) => rows.at(0))
      if (!investment) throw new Error('Active investment not found')
      const profit = money(investment.compoundedBalance)
        .minus(investment.principal)
        .toDecimalPlaces(8)
      if (profit.lte(0)) throw new Error('No investment profit is available')
      const invested = await account(tx, `USER:${user.id}:INVESTED`)
      const available = await account(tx, `USER:${user.id}:AVAILABLE`)
      const ledger = await postLedgerTransaction(tx, {
        eventType: 'INVESTMENT_PROFIT_RELEASED',
        referenceType: 'investment',
        referenceId: investment.id,
        idempotencyKey: `investment:${investment.id}:profit:${crypto.randomUUID()}`,
        description: 'Release compounded profit to available balance',
        effectiveAt: new Date(),
        createdBy: user.id,
        lines: [
          { accountId: invested, side: 'DEBIT', amount: profit },
          { accountId: available, side: 'CREDIT', amount: profit },
        ],
      })
      await tx
        .update(investments)
        .set({
          compoundedBalance: investment.principal,
          updatedAt: new Date(),
        })
        .where(eq(investments.id, investment.id))
      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'INVESTMENT_PROFIT_RELEASED',
        entityType: 'investment',
        entityId: investment.id,
        after: { amount: profit.toString(), ledgerTransactionId: ledger.id },
      })
    })
    return { success: true }
  })

export const addFundsToInvestment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      investmentId: z.string().uuid(),
      amount: z
        .string()
        .trim()
        .refine((value) => Number(value) > 0, 'Amount must be positive'),
      requestId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select id from investments where id = ${data.investmentId} for update`,
      )
      const investment = await tx
        .select()
        .from(investments)
        .where(
          and(
            eq(investments.id, data.investmentId),
            eq(investments.userId, user.id),
            eq(investments.status, 'ACTIVE'),
          ),
        )
        .limit(1)
        .then((rows) => rows.at(0))
      if (!investment) throw new Error('Active investment not found')
      const amount = money(data.amount).toDecimalPlaces(8)
      if (!amount.isFinite() || amount.lte(0))
        throw new Error('Amount must be positive')
      const settings = await tx
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0))
      if (!settings) throw new Error('Platform settings are missing')
      if (
        money(investment.principal).plus(amount).gt(settings.maximumInvestment)
      )
        throw new Error(
          `Investment principal cannot exceed ${settings.maximumInvestment} USDT`,
        )
      const available = await account(tx, `USER:${user.id}:AVAILABLE`)
      const invested = await account(tx, `USER:${user.id}:INVESTED`)
      await tx.execute(
        sql`select id from ledger_accounts where id = ${available} for update`,
      )
      const availableBalance = await tx
        .select({
          balance: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)`,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.accountId, available))
        .then((rows) => rows.at(0)?.balance ?? '0')
      if (money(availableBalance).lt(amount))
        throw new Error('Insufficient available balance')
      const ledger = await postLedgerTransaction(tx, {
        eventType: 'INVESTMENT_FUNDS_ADDED',
        referenceType: 'investment',
        referenceId: investment.id,
        idempotencyKey: `investment-add:${data.requestId}`,
        description: 'Add available funds to active investment',
        effectiveAt: new Date(),
        createdBy: user.id,
        lines: [
          { accountId: available, side: 'DEBIT', amount },
          { accountId: invested, side: 'CREDIT', amount },
        ],
      })
      await tx
        .update(investments)
        .set({
          principal: money(investment.principal).plus(amount).toString(),
          compoundedBalance: money(investment.compoundedBalance)
            .plus(amount)
            .toString(),
          updatedAt: new Date(),
        })
        .where(eq(investments.id, investment.id))
      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'INVESTMENT_FUNDS_ADDED',
        entityType: 'investment',
        entityId: investment.id,
        after: { amount: amount.toString(), ledgerTransactionId: ledger.id },
      })
    })
    return { success: true }
  })

export const requestInvestmentExit = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      investmentId: z.string().uuid(),
      note: z.string().trim().max(500),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const investment = await getDb()
      .select({ id: investments.id })
      .from(investments)
      .where(
        and(
          eq(investments.id, data.investmentId),
          eq(investments.userId, user.id),
          eq(investments.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (!investment) throw new Error('Active investment not found')
    const request = await getDb()
      .insert(investmentExitRequests)
      .values({
        investmentId: investment.id,
        userId: user.id,
        userNote: data.note || null,
      })
      .returning({ id: investmentExitRequests.id })
      .then((rows) => rows.at(0))
    if (!request) throw new Error('Exit request could not be created')
    return { success: true, requestId: request.id }
  })

export const cancelInvestmentExit = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const updated = await getDb()
      .update(investmentExitRequests)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(
        and(
          eq(investmentExitRequests.id, data.requestId),
          eq(investmentExitRequests.userId, user.id),
          inArray(investmentExitRequests.status, ['REQUESTED', 'DEFERRED']),
        ),
      )
      .returning({ id: investmentExitRequests.id })
      .then((rows) => rows.at(0))
    if (!updated) throw new Error('Active exit request not found')
    return { success: true }
  })

export const getAdminExitRequests = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return getDb()
      .select({
        id: investmentExitRequests.id,
        status: investmentExitRequests.status,
        investmentId: investmentExitRequests.investmentId,
        userName: users.displayName,
        userEmail: users.email,
        userNote: investmentExitRequests.userNote,
        decisionReason: investmentExitRequests.decisionReason,
        reviewAfter: investmentExitRequests.reviewAfter,
        principal: investments.principal,
        balance: investments.compoundedBalance,
        createdAt: investmentExitRequests.createdAt,
      })
      .from(investmentExitRequests)
      .innerJoin(
        investments,
        eq(investments.id, investmentExitRequests.investmentId),
      )
      .innerJoin(users, eq(users.id, investmentExitRequests.userId))
      .orderBy(desc(investmentExitRequests.createdAt))
      .limit(200)
  },
)

export const reviewInvestmentExit = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      requestId: z.string().uuid(),
      action: z.enum(['APPROVE', 'DEFER', 'REJECT']),
      reason: z.string().trim().max(500),
      reviewAfter: z.string().trim().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select id from investment_exit_requests where id = ${data.requestId} for update`,
      )
      const request = await tx
        .select()
        .from(investmentExitRequests)
        .where(eq(investmentExitRequests.id, data.requestId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (!request || !['REQUESTED', 'DEFERRED'].includes(request.status))
        throw new Error('Active exit request not found')
      if (data.action !== 'APPROVE' && data.reason.length < 3)
        throw new Error('A clear decision reason is required')
      if (data.action === 'APPROVE') {
        await tx.execute(
          sql`select id from investments where id = ${request.investmentId} for update`,
        )
        const investment = await tx
          .select()
          .from(investments)
          .where(eq(investments.id, request.investmentId))
          .limit(1)
          .then((rows) => rows.at(0))
        if (!investment || investment.status !== 'ACTIVE')
          throw new Error('Active investment not found')
        const amount = money(investment.compoundedBalance)
        const invested = await account(tx, `USER:${request.userId}:INVESTED`)
        const available = await account(tx, `USER:${request.userId}:AVAILABLE`)
        const ledger = await postLedgerTransaction(tx, {
          eventType: 'INVESTMENT_EXIT_APPROVED',
          referenceType: 'investment_exit_request',
          referenceId: request.id,
          idempotencyKey: `investment-exit:${request.id}:approved`,
          description:
            'Release investment balance after administrator approval',
          effectiveAt: new Date(),
          createdBy: admin.id,
          lines: [
            { accountId: invested, side: 'DEBIT', amount },
            { accountId: available, side: 'CREDIT', amount },
          ],
        })
        await tx
          .update(investments)
          .set({
            status: 'CANCELLED',
            compoundedBalance: '0',
            updatedAt: new Date(),
          })
          .where(eq(investments.id, investment.id))
        await tx
          .update(investmentExitRequests)
          .set({
            status: 'APPROVED',
            decisionReason: data.reason || 'Approved by administrator',
            reviewedBy: admin.id,
            reviewedAt: new Date(),
            releasedAmount: amount.toString(),
            releaseLedgerTransactionId: ledger.id,
            updatedAt: new Date(),
          })
          .where(eq(investmentExitRequests.id, request.id))
      } else {
        await tx
          .update(investmentExitRequests)
          .set({
            status: data.action === 'DEFER' ? 'DEFERRED' : 'REJECTED',
            decisionReason: data.reason,
            reviewAfter:
              data.action === 'DEFER' && data.reviewAfter
                ? new Date(data.reviewAfter)
                : null,
            reviewedBy: admin.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(investmentExitRequests.id, request.id))
      }
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: `INVESTMENT_EXIT_${data.action}`,
        entityType: 'investment_exit_request',
        entityId: request.id,
        before: { status: request.status },
        after: {
          action: data.action,
          reason: data.reason,
          reviewAfter: data.reviewAfter,
        },
      })
    })
    const reviewed = await getDb()
      .select({ userId: investmentExitRequests.userId })
      .from(investmentExitRequests)
      .where(eq(investmentExitRequests.id, data.requestId))
      .limit(1)
      .then((rows) => rows.at(0))
    if (reviewed)
      await Promise.allSettled([
        notifyUser({
          userId: reviewed.userId,
          category: 'INVESTMENT',
          title: `Investment exit ${data.action === 'APPROVE' ? 'approved' : data.action === 'DEFER' ? 'deferred' : 'rejected'}`,
          body:
            data.reason ||
            (data.action === 'APPROVE'
              ? 'Your investment balance was released to your available balance.'
              : 'Your investment exit request was reviewed.'),
          href: '/invest',
          eventKey: `investment-exit:${data.requestId}:${data.action.toLowerCase()}`,
        }),
      ])
    return { success: true }
  })
