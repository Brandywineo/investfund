import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  adminAlertDeliveries,
  adminAlertSettings,
  platformWallets,
  platformWalletTransactions,
  users,
  walletSets,
  withdrawals,
} from '#/db/schema'
import { notifyAdmins } from './notification.service'

type AdminAlertPayload = {
  amount: string
  asset: string
  walletSet?: string
  walletAddress?: string
  sourceAddress?: string
  txHash?: string
  sourceType?: 'USER_SWEEP' | 'DIRECT_HOT_DEPOSIT' | 'TEST'
  userName?: string
  userEmail?: string
  destinationAddress?: string
  feeAmount?: string
  netAmount?: string
  withdrawalId?: string
}

function metaWhatsAppConfig() {
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

function webBridgeConfig() {
  const url = process.env.WHATSAPP_WEB_BRIDGE_URL?.trim()
  const token = process.env.WHATSAPP_WEB_BRIDGE_TOKEN?.trim()
  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

export function whatsappProvider() {
  const requested = process.env.WHATSAPP_PROVIDER?.trim().toUpperCase()
  if (requested === 'WEB_BRIDGE') return webBridgeConfig() ? 'WEB_BRIDGE' : null
  if (requested === 'META') return metaWhatsAppConfig() ? 'META' : null
  if (webBridgeConfig()) return 'WEB_BRIDGE'
  if (metaWhatsAppConfig()) return 'META'
  return null
}

export function whatsappAlertsConfigured() {
  return Boolean(whatsappProvider())
}

export async function whatsappProviderStatus() {
  const provider = whatsappProvider()
  if (provider === 'META') return 'READY'
  if (provider !== 'WEB_BRIDGE') return 'NOT_CONFIGURED'
  const config = webBridgeConfig()
  if (!config) return 'NOT_CONFIGURED'
  try {
    const response = await fetch(`${config.url}/health`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(3_000),
    })
    const body = (await response.json()) as { state?: string }
    return response.ok ? body.state || 'UNKNOWN' : 'UNAVAILABLE'
  } catch {
    return 'UNAVAILABLE'
  }
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
  if (!settings) return 0

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
    const payload: AdminAlertPayload = {
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
    if (settings.adminPushEnabled) {
      await notifyAdmins({
        category: 'SYSTEM',
        title: 'Hot wallet funded',
        body: `${Number(transaction.amount).toFixed(2)} ${transaction.asset} reached ${transaction.walletSetName}.`,
        href: '/admin/wallets',
        eventKey: `admin-hot-wallet-deposit:${transaction.id}`,
      })
    }
    if (settings.whatsappEnabled && settings.whatsappRecipient) {
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
  }
  return queued
}

function alertText(category: string, payload: AdminAlertPayload) {
  if (category === 'WITHDRAWAL_REQUESTED') {
    return [
      'InvestFund withdrawal requested',
      '',
      `User: ${payload.userName} (${payload.userEmail})`,
      `Requested: ${payload.amount} ${payload.asset}`,
      `Fee: ${payload.feeAmount} ${payload.asset}`,
      `Net payout: ${payload.netAmount} ${payload.asset}`,
      `Destination: ${payload.destinationAddress}`,
      `Request ID: ${payload.withdrawalId}`,
    ].join('\n')
  }
  if (category === 'TEST')
    return 'InvestFund administrator alert test. No funds moved.'
  return [
    'InvestFund deposit confirmed',
    '',
    `Amount: ${payload.amount} ${payload.asset}`,
    `Wallet: ${payload.walletSet}`,
    `Source: ${payload.sourceType}`,
    `Transaction: ${payload.txHash}`,
  ].join('\n')
}

async function sendWebBridgeMessage(
  recipient: string,
  category: string,
  payload: AdminAlertPayload,
) {
  const config = webBridgeConfig()
  if (!config) throw new Error('WhatsApp Web bridge is not configured')
  const response = await fetch(`${config.url}/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(
      Number(process.env.WHATSAPP_REQUEST_TIMEOUT_MS || 10_000),
    ),
    body: JSON.stringify({
      recipient,
      message: alertText(category, payload),
    }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    messageId?: string
    error?: string
  }
  if (!response.ok)
    throw new Error(
      body.error || `WhatsApp bridge returned HTTP ${response.status}`,
    )
  return body.messageId ?? null
}

async function sendMetaWhatsAppTemplate(
  recipient: string,
  category: string,
  payload: AdminAlertPayload,
) {
  const config = metaWhatsAppConfig()
  if (!config) throw new Error('WhatsApp Cloud API is not configured')
  const isWithdrawal = category === 'WITHDRAWAL_REQUESTED'
  const templateName = isWithdrawal
    ? process.env.WHATSAPP_WITHDRAWAL_TEMPLATE_NAME?.trim() ||
      'investfund_withdrawal_requested'
    : config.templateName
  const parameters = isWithdrawal
    ? [
        payload.userName,
        payload.amount,
        payload.netAmount,
        payload.destinationAddress,
        payload.withdrawalId,
      ]
    : [
        payload.amount,
        payload.asset,
        payload.walletSet,
        payload.sourceType,
        payload.txHash,
      ]
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
          name: templateName,
          language: { code: config.templateLanguage },
          components: [
            {
              type: 'body',
              parameters: parameters.map((text) => ({
                type: 'text',
                text: text || '—',
              })),
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

async function sendWhatsApp(
  recipient: string,
  category: string,
  payload: AdminAlertPayload,
) {
  const provider = whatsappProvider()
  if (provider === 'WEB_BRIDGE')
    return sendWebBridgeMessage(recipient, category, payload)
  if (provider === 'META')
    return sendMetaWhatsAppTemplate(recipient, category, payload)
  throw new Error('No WhatsApp provider is configured')
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
      const providerMessageId = await sendWhatsApp(
        delivery.recipient,
        delivery.category,
        delivery.payload as AdminAlertPayload,
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
      } satisfies AdminAlertPayload,
    })
    .returning({ id: adminAlertDeliveries.id })
    .then((rows) => rows.at(0))
}

export async function queueWithdrawalRequestedAdminAlerts(
  withdrawalId: string,
) {
  const db = getDb()
  const [settings, withdrawal] = await Promise.all([
    db
      .select()
      .from(adminAlertSettings)
      .where(eq(adminAlertSettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select({
        id: withdrawals.id,
        amount: withdrawals.amount,
        feeAmount: withdrawals.feeAmount,
        netAmount: withdrawals.netAmount,
        destinationAddress: withdrawals.destinationAddress,
        network: withdrawals.network,
        userName: users.displayName,
        userEmail: users.email,
      })
      .from(withdrawals)
      .innerJoin(users, eq(users.id, withdrawals.userId))
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1)
      .then((rows) => rows.at(0)),
  ])
  if (!settings?.notifyWithdrawalRequests || !withdrawal) return false
  const payload: AdminAlertPayload = {
    amount: withdrawal.amount,
    asset: 'USDT',
    feeAmount: withdrawal.feeAmount,
    netAmount: withdrawal.netAmount,
    destinationAddress: withdrawal.destinationAddress,
    withdrawalId: withdrawal.id,
    userName: withdrawal.userName,
    userEmail: withdrawal.userEmail,
  }
  if (settings.adminPushEnabled) {
    await notifyAdmins({
      category: 'WITHDRAWAL',
      title: 'Withdrawal approval requested',
      body: `${withdrawal.userName} requested ${Number(withdrawal.amount).toFixed(2)} USDT to ${withdrawal.destinationAddress}.`,
      href: '/admin/custody',
      eventKey: `admin-withdrawal-requested:${withdrawal.id}`,
    })
  }
  if (settings.whatsappEnabled && settings.whatsappRecipient) {
    await db
      .insert(adminAlertDeliveries)
      .values({
        eventKey: `withdrawal-requested:${withdrawal.id}`,
        category: 'WITHDRAWAL_REQUESTED',
        recipient: normalizePhone(settings.whatsappRecipient),
        payload,
      })
      .onConflictDoNothing()
  }
  await processAdminAlertOutbox(10)
  return true
}
