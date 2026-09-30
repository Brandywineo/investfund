import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { auditLogs, emailOutbox, emailSettings } from '#/db/schema'
import { encryptEmailSecret } from './email-crypto'
import { processEmailOutbox, queueEmail } from './email.service'
import { getSessionUser } from './session'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN') {
    throw new Error('Administrator access required')
  }
  return user
}

export const getAdminEmailSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const db = getDb()
    const [settings, deliveries, counts] = await Promise.all([
      db
        .select()
        .from(emailSettings)
        .where(eq(emailSettings.id, 1))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({
          id: emailOutbox.id,
          recipient: emailOutbox.recipient,
          subject: emailOutbox.subject,
          category: emailOutbox.category,
          status: emailOutbox.status,
          attempts: emailOutbox.attempts,
          providerMessageId: emailOutbox.providerMessageId,
          failureReason: emailOutbox.failureReason,
          sentAt: emailOutbox.sentAt,
          createdAt: emailOutbox.createdAt,
        })
        .from(emailOutbox)
        .orderBy(desc(emailOutbox.createdAt))
        .limit(50),
      db
        .select({
          status: emailOutbox.status,
          count: sql<number>`count(*)::int`,
        })
        .from(emailOutbox)
        .groupBy(emailOutbox.status),
    ])
    return {
      settings: settings
        ? {
            provider: settings.provider,
            enabled: settings.enabled,
            verificationRequired: settings.verificationRequired,
            hasApiKey: Boolean(settings.encryptedApiKey),
            apiKeyLastFour: settings.apiKeyLastFour,
            fromName: settings.fromName,
            fromAddress: settings.fromAddress,
            replyToAddress: settings.replyToAddress,
            verificationExpiryMinutes: settings.verificationExpiryMinutes,
            resetExpiryMinutes: settings.resetExpiryMinutes,
            lastSuccessfulDeliveryAt: settings.lastSuccessfulDeliveryAt,
            lastFailureAt: settings.lastFailureAt,
            lastFailureReason: settings.lastFailureReason,
          }
        : null,
      deliveries,
      counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
      encryptionConfigured: Boolean(process.env.EMAIL_SETTINGS_ENCRYPTION_KEY),
    }
  },
)

export const updateAdminEmailSettings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      enabled: z.boolean(),
      verificationRequired: z.boolean(),
      apiKey: z.string().trim().max(500).optional(),
      fromName: z.string().trim().min(2).max(80),
      fromAddress: z.string().trim().toLowerCase().email().max(254),
      replyToAddress: z
        .union([
          z.string().trim().toLowerCase().email().max(254),
          z.literal(''),
        ])
        .optional(),
      verificationExpiryMinutes: z.number().int().min(15).max(10080),
      resetExpiryMinutes: z.number().int().min(10).max(1440),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const before = await getDb()
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0))
    const apiKey = data.apiKey || undefined
    const encryptedApiKey = apiKey
      ? encryptEmailSecret(apiKey)
      : before?.encryptedApiKey
    if (data.enabled && !encryptedApiKey) {
      throw new Error('Add a Resend API key before enabling email delivery')
    }
    if (data.verificationRequired && !data.enabled) {
      throw new Error('Email delivery must be enabled before verification')
    }
    const values = {
      provider: 'RESEND' as const,
      enabled: data.enabled,
      verificationRequired: data.verificationRequired,
      encryptedApiKey,
      apiKeyLastFour: apiKey ? apiKey.slice(-4) : before?.apiKeyLastFour,
      fromName: data.fromName,
      fromAddress: data.fromAddress,
      replyToAddress: data.replyToAddress || null,
      verificationExpiryMinutes: data.verificationExpiryMinutes,
      resetExpiryMinutes: data.resetExpiryMinutes,
      updatedBy: admin.id,
      updatedAt: new Date(),
    }
    await getDb().transaction(async (tx) => {
      await tx
        .insert(emailSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: emailSettings.id, set: values })
      await tx.insert(auditLogs).values({
        actorUserId: admin.id,
        action: 'EMAIL_SETTINGS_UPDATED',
        entityType: 'email_settings',
        entityId: '1',
        before: before
          ? {
              enabled: before.enabled,
              verificationRequired: before.verificationRequired,
              fromAddress: before.fromAddress,
              hasApiKey: Boolean(before.encryptedApiKey),
            }
          : null,
        after: {
          enabled: data.enabled,
          verificationRequired: data.verificationRequired,
          fromAddress: data.fromAddress,
          apiKeyReplaced: Boolean(apiKey),
        },
      })
    })
    return { success: true }
  })

export const sendAdminTestEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ recipient: z.string().trim().toLowerCase().email() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await queueEmail({
      recipient: data.recipient,
      category: 'TEST',
      subject: 'InvestFund email delivery test',
      textBody:
        'Your InvestFund Resend configuration is working. Email delivery is ready.',
      htmlBody:
        '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#eef1eb;padding:32px"><div style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:24px"><h1 style="color:#123d2d">Email delivery is ready</h1><p>Your InvestFund Resend configuration is working.</p></div></body></html>',
    })
    const result = await processEmailOutbox(5)
    if (!result.sent)
      throw new Error('Test email was not delivered; check the latest failure')
    return result
  })

export const retryAdminEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await getDb()
      .update(emailOutbox)
      .set({
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, data.id))
    return processEmailOutbox(5)
  })
