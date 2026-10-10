import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { emailOutbox, emailSettings } from '#/db/schema'
import { decryptEmailSecret } from './email-crypto'

export type QueuedEmail = {
  recipient: string
  subject: string
  htmlBody: string
  textBody: string
  category: string
  eventKey?: string | null
}

export function appOrigin(): string {
  return (process.env.APP_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')
}

export async function getEmailSettings() {
  return getDb()
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
}

export async function queueEmail(message: QueuedEmail): Promise<string> {
  const row = await getDb()
    .insert(emailOutbox)
    .values(message)
    .returning({ id: emailOutbox.id })
    .then((rows) => rows.at(0))
  if (!row) throw new Error('Email could not be queued')
  return row.id
}

async function sendWithResend(
  settings: NonNullable<Awaited<ReturnType<typeof getEmailSettings>>>,
  message: QueuedEmail & { id: string },
): Promise<string> {
  if (!settings.encryptedApiKey) throw new Error('Resend API key is missing')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${decryptEmailSecret(settings.encryptedApiKey)}`,
      'content-type': 'application/json',
      'Idempotency-Key': `investfund-email:${message.id}`,
    },
    body: JSON.stringify({
      from: `${settings.fromName} <${settings.fromAddress}>`,
      to: [message.recipient],
      subject: message.subject,
      html: message.htmlBody,
      text: message.textBody,
      reply_to: settings.replyToAddress || undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await response.json().catch(() => ({}))) as {
    id?: string
    message?: string
    name?: string
  }
  if (!response.ok) {
    throw new Error(
      body.message || body.name || `Resend HTTP ${response.status}`,
    )
  }
  if (!body.id) throw new Error('Resend response did not include a message ID')
  return body.id
}

export async function processEmailOutbox(limit = 20) {
  const settings = await getEmailSettings()
  if (!settings?.enabled) return { processed: 0, sent: 0, failed: 0 }

  // Recover a worker interrupted after claiming a job. Resend's stable key
  // prevents an accepted delivery being sent again during retries.
  await getDb()
    .update(emailOutbox)
    .set({ status: 'FAILED', nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(emailOutbox.status, 'PROCESSING'),
        lte(emailOutbox.updatedAt, new Date(Date.now() - 5 * 60_000)),
      ),
    )

  const candidates = await getDb()
    .select()
    .from(emailOutbox)
    .where(
      and(
        inArray(emailOutbox.status, ['PENDING', 'FAILED']),
        lte(emailOutbox.nextAttemptAt, new Date()),
        sql`${emailOutbox.attempts} < 5`,
      ),
    )
    .orderBy(asc(emailOutbox.createdAt))
    .limit(limit)

  let sent = 0
  let failed = 0
  for (const candidate of candidates) {
    const claimed = await getDb()
      .update(emailOutbox)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(
        and(
          eq(emailOutbox.id, candidate.id),
          inArray(emailOutbox.status, ['PENDING', 'FAILED']),
        ),
      )
      .returning({ id: emailOutbox.id })
      .then((rows) => rows.at(0))
    if (!claimed) continue

    try {
      const providerMessageId = await sendWithResend(settings, candidate)
      await getDb()
        .update(emailOutbox)
        .set({
          status: 'SENT',
          providerMessageId,
          failureReason: null,
          attempts: candidate.attempts + 1,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailOutbox.id, candidate.id))
      await getDb()
        .update(emailSettings)
        .set({
          lastSuccessfulDeliveryAt: new Date(),
          lastFailureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(emailSettings.id, 1))
      sent += 1
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Delivery failed'
      const attempts = candidate.attempts + 1
      const delayMinutes = Math.min(60, 2 ** attempts)
      await getDb()
        .update(emailOutbox)
        .set({
          status: 'FAILED',
          attempts,
          failureReason: reason.slice(0, 1_000),
          nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
          updatedAt: new Date(),
        })
        .where(eq(emailOutbox.id, candidate.id))
      await getDb()
        .update(emailSettings)
        .set({
          lastFailureAt: new Date(),
          lastFailureReason: reason.slice(0, 1_000),
          updatedAt: new Date(),
        })
        .where(eq(emailSettings.id, 1))
      failed += 1
    }
  }
  return { processed: sent + failed, sent, failed }
}
