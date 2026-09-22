import webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  notifications,
  notificationPreferences,
  pushSubscriptions,
} from '#/db/schema'

export type NotificationCategory =
  'TRADING' | 'PROFIT' | 'REFERRAL' | 'WITHDRAWAL' | 'INVESTMENT' | 'SYSTEM'

const preferenceColumn = {
  TRADING: 'trading',
  PROFIT: 'profit',
  REFERRAL: 'referral',
  WITHDRAWAL: 'withdrawal',
  INVESTMENT: 'investment',
  SYSTEM: 'system',
} as const

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@investfund.local',
    publicKey,
    privateKey,
  )
  return true
}

export async function notifyUser(input: {
  userId: string
  category: NotificationCategory
  title: string
  body: string
  href?: string
  eventKey: string
}) {
  const db = getDb()
  const item = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      category: input.category,
      title: input.title,
      body: input.body,
      href: input.href || '/app',
      eventKey: input.eventKey,
    })
    .onConflictDoNothing()
    .returning()
    .then((rows) => rows.at(0))
  if (!item || !configureWebPush()) return item

  const preference = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, input.userId))
    .limit(1)
    .then((rows) => rows.at(0))
  const key = preferenceColumn[input.category]
  if (preference && !preference[key]) return item

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, input.userId))
  let sent = false
  let lastFailure: string | null = null
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title: input.title,
          body: input.body,
          href: input.href || '/app',
          tag: input.eventKey,
        }),
      )
      sent = true
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(pushSubscriptions.id, subscription.id))
    } catch (cause) {
      const statusCode = (cause as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, subscription.id))
      }
      lastFailure =
        cause instanceof Error
          ? cause.message.slice(0, 500)
          : 'Push delivery failed'
    }
  }
  await db
    .update(notifications)
    .set({
      pushSentAt: sent ? new Date() : null,
      pushFailure: sent ? null : lastFailure,
    })
    .where(
      and(
        eq(notifications.id, item.id),
        eq(notifications.userId, input.userId),
      ),
    )
  return item
}
