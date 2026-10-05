import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  adminAlertDeliveries,
  adminAlertSettings,
  platformWallets,
  platformWalletTransactions,
  walletSets,
} from '#/db/schema'

type HotWalletAlertPayload = {
  amount: string
  asset: string
  walletSet: string
  walletAddress: string
  sourceAddress: string
  txHash: string
  sourceType: 'USER_SWEEP' | 'DIRECT_HOT_DEPOSIT' | 'TEST'
}

function whatsappConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const templateName =
    process.env.WHATSAPP_TEMPLATE_NAME?.trim() ||
    'investfund_hot_wallet_deposit'
  const templateLanguage =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en'
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v23.0'
  if (!accessToken || !phoneNumberId) return null
  return {
    accessToken,
    phoneNumberId,
    templateName,
    templateLanguage,
    apiVersion,
  }
}

export function whatsappAlertsConfigured() {
  return Boolean(whatsappConfig())
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '')
}

export async function queueConfirmedHotWalletAlerts() {
  const db = getDb()
  const settings = await db
    .select()
    .from(adminAlertSettings)
    .where(eq(adminAlertSettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!settings?.whatsappEnabled || !settings.whatsappRecipient) return 0

  const eligibleClassifications = [
    ...(settings.notifyUserSweeps ? ['USER_SWEEP'] : []),
  ]
  const classificationFilter = or(
    eligibleClassifications.length
      ? inArray(
          platformWalletTransactions.classification,
          eligibleClassifications,
        )
      : undefined,
    settings.notifyDirectHotDeposits
      ? isNull(platformWalletTransactions.classification)
      : undefined,
  )
  if (!classificationFilter) return 0

  const transactions = await db
    .select({
      id: platformWalletTransactions.id,
      amount: platformWalletTransactions.amount,
      asset: platformWalletTransactions.asset,
      fromAddress: platformWalletTransactions.fromAddress,
      toAddress: platformWalletTransactions.toAddress,
      txHash: platformWalletTransactions.txHash,
      classification: platformWalletTransactions.classification,
      walletSetName: walletSets.name,
    })
    .from(platformWalletTransactions)
    .innerJoin(
      platformWallets,
      eq(platformWallets.id, platformWalletTransactions.platformWalletId),
    )
    .innerJoin(walletSets, eq(walletSets.id, platformWallets.walletSetId))
    .where(
      and(
        eq(platformWalletTransactions.status, 'CONFIRMED'),
        eq(platformWalletTransactions.direction, 'INCOMING'),
        eq(platformWalletTransactions.asset, 'USDT'),
        eq(platformWallets.role, 'HOT_WITHDRAWAL'),
        classificationFilter,
        sql`${platformWalletTransactions.observedAt} >= ${settings.updatedAt}`,
        sql`${platformWalletTransactions.amount} >= ${settings.minimumAlertAmount}`,
      ),
    )
    .orderBy(asc(platformWalletTransactions.observedAt))

  let queued = 0
  for (const transaction of transactions) {
    const payload: HotWalletAlertPayload = {
      amount: transaction.amount,
      asset: transaction.asset,
      walletSet: transaction.walletSetName,
      walletAddress: transaction.toAddress,
      sourceAddress: transaction.fromAddress,
      txHash: transaction.txHash,
      sourceType:
        transaction.classification === 'USER_SWEEP'
          ? 'USER_SWEEP'
          : 'DIRECT_HOT_DEPOSIT',
    }
    const inserted = await db
      .insert(adminAlertDeliveries)
      .values({
        eventKey: `hot-wallet-deposit:${transaction.id}`,
        category: 'HOT_WALLET_DEPOSIT',
        recipient: normalizePhone(settings.whatsappRecipient),
        payload,
      })
      .onConflictDoNothing()
      .returning({ id: adminAlertDeliveries.id })
      .then((rows) => rows.at(0))
    if (inserted) queued += 1
  }
  return queued
}

async function sendWhatsAppTemplate(
  recipient: string,
  payload: HotWalletAlertPayload,
) {
  const config = whatsappConfig()
  if (!config) throw new Error('WhatsApp Cloud API is not configured')
  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(
        Number(process.env.WHATSAPP_REQUEST_TIMEOUT_MS || 10_000),
      ),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: config.templateName,
          language: { code: config.templateLanguage },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: payload.amount },
                { type: 'text', text: payload.asset },
                { type: 'text', text: payload.walletSet },
                { type: 'text', text: payload.sourceType },
                { type: 'text', text: payload.txHash },
              ],
            },
          ],
        },
      }),
    },
  )
  const body = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(
      body.error?.message || `WhatsApp returned HTTP ${response.status}`,
    )
  }
  return body.messages?.at(0)?.id ?? null
}

export async function processAdminAlertOutbox(limit = 10) {
  const db = getDb()
  const settings = await db
    .select()
    .from(adminAlertSettings)
    .where(eq(adminAlertSettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!settings?.whatsappEnabled) return { sent: 0, failed: 0 }

  const deliveries = await db
    .select()
    .from(adminAlertDeliveries)
    .where(
      and(
        inArray(adminAlertDeliveries.status, ['PENDING', 'FAILED']),
        lte(adminAlertDeliveries.nextAttemptAt, new Date()),
        sql`${adminAlertDeliveries.attempts} < 5`,
      ),
    )
    .orderBy(asc(adminAlertDeliveries.createdAt))
    .limit(limit)
  let sent = 0
  let failed = 0
  for (const delivery of deliveries) {
    const attempts = delivery.attempts + 1
    await db
      .update(adminAlertDeliveries)
      .set({ status: 'PROCESSING', attempts, updatedAt: new Date() })
      .where(eq(adminAlertDeliveries.id, delivery.id))
    try {
      const providerMessageId = await sendWhatsAppTemplate(
        delivery.recipient,
        delivery.payload as HotWalletAlertPayload,
      )
      const now = new Date()
      await db.transaction(async (tx) => {
        await tx
          .update(adminAlertDeliveries)
          .set({
            status: 'SENT',
            providerMessageId,
            failureReason: null,
            sentAt: now,
            updatedAt: now,
          })
          .where(eq(adminAlertDeliveries.id, delivery.id))
        await tx
          .update(adminAlertSettings)
          .set({
            lastSuccessfulDeliveryAt: now,
            lastFailureReason: null,
          })
          .where(eq(adminAlertSettings.id, 1))
      })
      sent += 1
    } catch (cause) {
      const failureReason =
        cause instanceof Error ? cause.message : 'WhatsApp delivery failed'
      const now = new Date()
      const nextAttemptAt = new Date(
        Date.now() + Math.min(60, 2 ** attempts) * 60_000,
      )
      await db.transaction(async (tx) => {
        await tx
          .update(adminAlertDeliveries)
          .set({
            status: 'FAILED',
            failureReason,
            nextAttemptAt,
            updatedAt: now,
          })
          .where(eq(adminAlertDeliveries.id, delivery.id))
        await tx
          .update(adminAlertSettings)
          .set({
            lastFailureAt: now,
            lastFailureReason: failureReason,
          })
          .where(eq(adminAlertSettings.id, 1))
      })
      failed += 1
    }
  }
  return { sent, failed }
}

export async function queueAdminAlertTest(recipient: string) {
  return getDb()
    .insert(adminAlertDeliveries)
    .values({
      eventKey: `whatsapp-test:${crypto.randomUUID()}`,
      category: 'TEST',
      recipient: normalizePhone(recipient),
      payload: {
        amount: '300.00',
        asset: 'USDT',
        walletSet: 'InvestFund test wallet',
        walletAddress: 'TEST',
        sourceAddress: 'TEST',
        txHash: 'Configuration test — no funds moved',
        sourceType: 'TEST',
      } satisfies HotWalletAlertPayload,
    })
    .returning({ id: adminAlertDeliveries.id })
    .then((rows) => rows.at(0))
}
