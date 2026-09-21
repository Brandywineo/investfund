import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { getDb } from '#/db'
import { auditLogs, investments } from '#/db/schema'
import {
  accrualDateFromKey,
  businessDateKey,
  DEFAULT_BUSINESS_TIMEZONE,
} from '#/domain/business-date'
import { postDailyAccrual } from './ledger.service'

export async function runAccrualBatch(
  options: { businessDate?: string; actorUserId?: string } = {},
) {
  const dateKey =
    options.businessDate ??
    businessDateKey(new Date(), DEFAULT_BUSINESS_TIMEZONE)
  const accrualDate = accrualDateFromKey(dateKey)
  const due = await getDb()
    .select({ id: investments.id })
    .from(investments)
    .where(
      and(
        eq(investments.status, 'ACTIVE'),
        or(
          isNull(investments.lastAccruedOn),
          lt(investments.lastAccruedOn, accrualDate),
        ),
      ),
    )
  let posted = 0
  const failures: Array<{ investmentId: string; reason: string }> = []
  for (const investment of due) {
    try {
      await postDailyAccrual(investment.id, accrualDate)
      posted += 1
    } catch (cause) {
      failures.push({
        investmentId: investment.id,
        reason: cause instanceof Error ? cause.message : 'Unknown error',
      })
    }
  }
  await getDb()
    .insert(auditLogs)
    .values({
      actorUserId: options.actorUserId,
      action: 'DAILY_ACCRUAL_BATCH_RUN',
      entityType: 'daily_accrual_batch',
      entityId: dateKey,
      after: {
        dateKey,
        due: due.length,
        posted,
        failed: failures.length,
        automated: !options.actorUserId,
      },
    })
  return { dateKey, due: due.length, posted, failures }
}
