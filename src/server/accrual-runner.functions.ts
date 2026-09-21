import { createServerFn } from '@tanstack/react-start'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { auditLogs, investments } from '#/db/schema'
import { accrualDateFromKey, businessDateKey, DEFAULT_BUSINESS_TIMEZONE } from '#/domain/business-date'
import { postDailyAccrual } from './ledger.service'
import { getSessionUser } from './session'

export const runDailyAccruals = createServerFn({ method: 'POST' })
  .validator(z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
  .handler(async ({ data }) => {
    const admin = await getSessionUser()
    if (!admin || admin.role !== 'ADMIN') throw new Error('Administrator access required')
    const dateKey = data.businessDate ?? businessDateKey(new Date(), DEFAULT_BUSINESS_TIMEZONE)
    const accrualDate = accrualDateFromKey(dateKey)
    const due = await getDb().select({ id: investments.id }).from(investments).where(and(eq(investments.status, 'ACTIVE'), or(isNull(investments.lastAccruedOn), lt(investments.lastAccruedOn, accrualDate))))
    let posted = 0
    const failures: Array<{ investmentId: string; reason: string }> = []
    for (const investment of due) {
      try { await postDailyAccrual(investment.id, accrualDate); posted += 1 }
      catch (cause) { failures.push({ investmentId: investment.id, reason: cause instanceof Error ? cause.message : 'Unknown error' }) }
    }
    await getDb().insert(auditLogs).values({ actorUserId: admin.id, action: 'DAILY_ACCRUAL_BATCH_RUN', entityType: 'daily_accrual_batch', entityId: dateKey, after: { dateKey, due: due.length, posted, failed: failures.length } })
    return { dateKey, due: due.length, posted, failures }
  })
