import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  adminAlertDeliveries,
  adminAlertSettings,
  auditLogs,
  platformSettings,
} from '#/db/schema'
import {
  processAdminAlertOutbox,
  queueAdminAlertTest,
  whatsappAlertsConfigured,
  whatsappProvider,
  whatsappProviderStatus,
} from './admin-alert.service'
import { getSessionUser } from './session'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN')
    throw new Error('Administrator access required')
  return user
}

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Use an international WhatsApp number')

export const getAdminAlertSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const db = getDb()
    const [settings, support, deliveries, counts] = await Promise.all([
      db
        .select()
        .from(adminAlertSettings)
        .where(eq(adminAlertSettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({
          email: platformSettings.supportEmail,
          enabled: platformSettings.supportEmailEnabled,
        })
        .from(platformSettings)
        .where(eq(platformSettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({
          id: adminAlertDeliveries.id,
          recipient: adminAlertDeliveries.recipient,
          category: adminAlertDeliveries.category,
          status: adminAlertDeliveries.status,
          attempts: adminAlertDeliveries.attempts,
          providerMessageId: adminAlertDeliveries.providerMessageId,
          failureReason: adminAlertDeliveries.failureReason,
          sentAt: adminAlertDeliveries.sentAt,
          createdAt: adminAlertDeliveries.createdAt,
        })
        .from(adminAlertDeliveries)
        .orderBy(desc(adminAlertDeliveries.createdAt))
        .limit(50),
      db
        .select({
          status: adminAlertDeliveries.status,
          count: sql<number>`count(*)::int`,
        })
        .from(adminAlertDeliveries)
        .groupBy(adminAlertDeliveries.status),
    ])
    return {
      settings,
      support: support ?? {
        email: 'support@investfund.site',
        enabled: true,
      },
      deliveries,
      counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
      providerConfigured: whatsappAlertsConfigured(),
      provider: whatsappProvider(),
      providerStatus: await whatsappProviderStatus(),
      templateName:
        process.env.WHATSAPP_TEMPLATE_NAME || 'investfund_hot_wallet_deposit',
    }
  },
)

export const updateAdminAlertSettings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      whatsappEnabled: z.boolean(),
      adminPushEnabled: z.boolean(),
      whatsappRecipient: z.union([phoneSchema, z.literal('')]),
      notifyUserSweeps: z.boolean(),
      notifyDirectHotDeposits: z.boolean(),
      notifyWithdrawalRequests: z.boolean(),
      minimumAlertAmount: z.number().min(0.1).max(1_000_000_000),
      supportEmail: z.string().trim().toLowerCase().email().max(254),
      supportEmailEnabled: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (data.whatsappEnabled && !data.whatsappRecipient)
      throw new Error('Add an administrator WhatsApp number first')
    if (data.whatsappEnabled && !whatsappAlertsConfigured())
      throw new Error('Configure the WhatsApp Cloud API on the server first')
    const db = getDb()
    const before = await db
      .select()
      .from(adminAlertSettings)
      .where(eq(adminAlertSettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    const alertValues = {
      adminPushEnabled: data.adminPushEnabled,
      whatsappEnabled: data.whatsappEnabled,
      whatsappRecipient: data.whatsappRecipient || null,
      notifyUserSweeps: data.notifyUserSweeps,
      notifyDirectHotDeposits: data.notifyDirectHotDeposits,
      notifyWithdrawalRequests: data.notifyWithdrawalRequests,
      minimumAlertAmount: data.minimumAlertAmount.toFixed(8),
      updatedBy: admin.id,
      updatedAt: new Date(),
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(adminAlertSettings)
        .values({ id: 1, ...alertValues })
        .onConflictDoUpdate({ target: adminAlertSettings.id, set: alertValues })
      await tx
        .insert(platformSettings)
        .values({
          id: 1,
          supportEmail: data.supportEmail,
          supportEmailEnabled: data.supportEmailEnabled,
        })
        .onConflictDoUpdate({
          target: platformSettings.id,
          set: {
            supportEmail: data.supportEmail,
            supportEmailEnabled: data.supportEmailEnabled,
            updatedAt: new Date(),
          },
        })
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: 'ADMIN_ALERT_SETTINGS_UPDATED',
        entityType: 'admin_alert_settings',
        entityId: '1',
        before: before
          ? {
              whatsappEnabled: before.whatsappEnabled,
              whatsappRecipient: before.whatsappRecipient,
            }
          : null,
        after: {
          adminPushEnabled: data.adminPushEnabled,
          whatsappEnabled: data.whatsappEnabled,
          whatsappRecipient: data.whatsappRecipient || null,
          notifyWithdrawalRequests: data.notifyWithdrawalRequests,
          supportEmail: data.supportEmail,
          supportEmailEnabled: data.supportEmailEnabled,
        },
      })
    })
    return { success: true }
  })

export const sendAdminWhatsAppTest = createServerFn({ method: 'POST' })
  .validator(z.object({ recipient: phoneSchema }))
  .handler(async ({ data }) => {
    await requireAdmin()
    if (!whatsappAlertsConfigured())
      throw new Error('WhatsApp Cloud API is not configured')
    const settings = await getDb()
      .select()
      .from(adminAlertSettings)
      .where(eq(adminAlertSettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!settings?.whatsappEnabled)
      throw new Error('Enable WhatsApp alerts before sending a test')
    await queueAdminAlertTest(data.recipient)
    const result = await processAdminAlertOutbox(5)
    if (!result.sent)
      throw new Error('Test alert was not delivered; check recent attempts')
    return result
  })

export const retryAdminAlert = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await getDb()
      .update(adminAlertDeliveries)
      .set({
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(adminAlertDeliveries.id, data.id))
    return processAdminAlertOutbox(5)
  })
