import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  notifications,
  notificationPreferences,
  pushSubscriptions,
} from '#/db/schema'
import { getSessionUser } from './session'

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

export const getNotificationCenter = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const db = getDb()
    await db
      .insert(notificationPreferences)
      .values({ userId: user.id })
      .onConflictDoNothing()
    const [items, preferences, unread] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(100),
      db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, user.id))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
        )
        .then((rows) => rows.at(0)?.count ?? 0),
    ])
    return {
      items,
      preferences,
      unread,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    }
  },
)

export const savePushSubscription = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      endpoint: z.string().url().max(2000),
      p256dh: z.string().min(1).max(500),
      auth: z.string().min(1).max(500),
      userAgent: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    await getDb()
      .insert(pushSubscriptions)
      .values({ ...data, userId: user.id })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: user.id,
          p256dh: data.p256dh,
          auth: data.auth,
          userAgent: data.userAgent,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    return { success: true }
  })

export const removePushSubscription = createServerFn({ method: 'POST' })
  .validator(z.object({ endpoint: z.string().url().max(2000) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await getDb()
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, data.endpoint),
        ),
      )
    return { success: true }
  })

export const updateNotificationPreferences = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      trading: z.boolean(),
      profit: z.boolean(),
      referral: z.boolean(),
      withdrawal: z.boolean(),
      investment: z.boolean(),
      system: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    await getDb()
      .insert(notificationPreferences)
      .values({ userId: user.id, ...data })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...data, updatedAt: new Date() },
      })
    return { success: true }
  })

export const markNotificationsRead = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    await getDb()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
      )
    return { success: true }
  },
)
