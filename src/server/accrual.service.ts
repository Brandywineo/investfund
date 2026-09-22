import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { getDb } from '#/db'
import { auditLogs, investments } from '#/db/schema'
import {
  accrualDateFromKey,
  businessDateKey,
  DEFAULT_BUSINESS_TIMEZONE,
} from '#/domain/business-date'
import { postDailyAccrual } from './ledger.service'
import { notifyUser } from './notification.service'

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
      const result = await postDailyAccrual(investment.id, accrualDate)
      await Promise.allSettled([
        notifyUser({
          userId: result.userId,
          category: 'PROFIT',
          title: 'Daily profit posted',
          body: `${result.amount.toFixed(2)} USDT was added to your investment.`,
          href: '/invest',
          eventKey: `accrual:${result.accrualId}`,
        }),
        ...result.commissions.map((commission) =>
          notifyUser({
            userId: commission.userId,
            category: 'REFERRAL',
            title: 'Referral profit earned',
            body: `${Number(commission.amount).toFixed(2)} USDT was added to your available balance from your Level ${commission.level} network.`,
            href: '/referrals',
            eventKey: `referral:${result.accrualId}:level:${commission.level}`,
          }),
        ),
      ])
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
