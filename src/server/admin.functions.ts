import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { accrualRates, auditLogs, platformSettings } from '#/db/schema'
import { getSessionUser } from './session'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

export const getAdminInvestmentSettings = createServerFn({
  method: 'GET',
}).handler(async () => {
  await requireAdmin()
  const db = getDb()
  const [settings, currentRate] = await Promise.all([
    db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select()
      .from(accrualRates)
      .where(isNull(accrualRates.effectiveUntil))
      .orderBy(desc(accrualRates.effectiveFrom))
      .limit(1)
      .then((rows) => rows.at(0)),
  ])
  if (!settings) throw new Error('Platform settings are not initialized')
  return { settings, currentRate: currentRate?.dailyRatePercent ?? '0' }
})

export const updateInvestmentSettings = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        minimum: z.number().positive().max(1_000_000),
        maximum: z.number().positive().max(1_000_000),
      })
      .refine(
        (value) => value.maximum >= value.minimum,
        'Maximum must be at least the minimum',
      ),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    await getDb().transaction(async (tx) => {
      const before = await tx
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0))
      await tx
        .update(platformSettings)
        .set({
          minimumInvestment: String(data.minimum),
          maximumInvestment: String(data.maximum),
          updatedAt: new Date(),
        })
        .where(eq(platformSettings.id, 1))
      await tx
        .insert(auditLogs)
        .values({
          actorUserId: admin.id,
          action: 'INVESTMENT_LIMITS_UPDATED',
          entityType: 'platform_settings',
          entityId: '1',
          before,
          after: data,
        })
    })
    return { success: true }
  })

export const updateWithdrawalFee = createServerFn({ method: 'POST' })
  .validator(z.object({ feePercent: z.number().min(0).max(25) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    await getDb().transaction(async (tx) => {
      const before = await tx
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0))
      await tx
        .update(platformSettings)
        .set({
          withdrawalFeePercent: String(data.feePercent),
          updatedAt: new Date(),
        })
        .where(eq(platformSettings.id, 1))
      await tx
        .insert(auditLogs)
        .values({
          actorUserId: admin.id,
          action: 'WITHDRAWAL_FEE_UPDATED',
          entityType: 'platform_settings',
          entityId: '1',
          before,
          after: { feePercent: data.feePercent },
        })
    })
    return { success: true }
  })

export const setDailyRate = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ratePercent: z.number().positive().max(100),
      reason: z.string().trim().min(3).max(250),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const now = new Date()
    await getDb().transaction(async (tx) => {
      await tx
        .update(accrualRates)
        .set({ effectiveUntil: now })
        .where(
          and(
            isNull(accrualRates.effectiveUntil),
            lte(accrualRates.effectiveFrom, now),
          ),
        )
      const created = await tx
        .insert(accrualRates)
        .values({
          dailyRatePercent: String(data.ratePercent),
          effectiveFrom: now,
          createdBy: admin.id,
          reason: data.reason,
        })
        .returning({ id: accrualRates.id })
        .then((rows) => rows.at(0))
      await tx
        .insert(auditLogs)
        .values({
          actorUserId: admin.id,
          action: 'DAILY_RATE_CHANGED',
          entityType: 'accrual_rate',
          entityId: created?.id,
          after: {
            ratePercent: data.ratePercent,
            reason: data.reason,
            effectiveFrom: now.toISOString(),
          },
        })
    })
    return { success: true }
  })
