import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  notifications,
  supportConversations,
  supportMessages,
  users,
} from '#/db/schema'
import { getSessionUser } from './session'

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}
const targetInput = z.object({ userId: z.string().uuid().optional() })
function ownerId(user: { id: string; role: string }, requested?: string) {
  if (requested && requested !== user.id && user.role !== 'ADMIN')
    throw new Error('Private support conversation access denied')
  return requested ?? user.id
}

export const getSupportInbox = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    if (user.role !== 'ADMIN') throw new Error('Administrator access required')
    return getDb()
      .select({
        userId: supportConversations.userId,
        name: users.displayName,
        email: users.email,
        updatedAt: supportConversations.updatedAt,
        unread: sql<number>`(select count(*)::int from support_messages sm where sm.conversation_id = ${supportConversations.id} and sm.from_admin = false and (${supportConversations.adminReadAt} is null or sm.created_at > ${supportConversations.adminReadAt}))`,
      })
      .from(supportConversations)
      .innerJoin(users, eq(users.id, supportConversations.userId))
      .orderBy(desc(supportConversations.updatedAt))
      .limit(250)
  },
)

export const getSupportConversation = createServerFn({ method: 'GET' })
  .validator(
    targetInput.extend({
      before: z
        .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const target = ownerId(user, data.userId)
    const db = getDb()
    const owner = await db
      .select({ id: users.id, name: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, target))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!owner) throw new Error('User not found')
    const conversation = await db
      .select()
      .from(supportConversations)
      .where(eq(supportConversations.userId, target))
      .limit(1)
      .then((rows) => rows.at(0))
    if (!conversation) return { owner, messages: [], olderCursor: null }
    const rows = await db
      .select({
        id: supportMessages.id,
        body: supportMessages.body,
        fromAdmin: supportMessages.fromAdmin,
        createdAt: supportMessages.createdAt,
      })
      .from(supportMessages)
      .where(
        and(
          eq(supportMessages.conversationId, conversation.id),
          data.before
            ? or(
                lt(supportMessages.createdAt, new Date(data.before.createdAt)),
                and(
                  eq(
                    supportMessages.createdAt,
                    new Date(data.before.createdAt),
                  ),
                  lt(supportMessages.id, data.before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id))
      .limit(51)
    const page = rows.slice(0, 50)
    const oldest = page.at(-1)
    return {
      owner,
      messages: page.reverse(),
      olderCursor:
        rows.length > 50 && oldest
          ? { id: oldest.id, createdAt: oldest.createdAt.toISOString() }
          : null,
    }
  })

export const markSupportRead = createServerFn({ method: 'POST' })
  .validator(targetInput.extend({ messageId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const target = ownerId(user, data.userId)
    const db = getDb()
    const message = await db
      .select({
        createdAt: supportMessages.createdAt,
        conversationId: supportConversations.id,
      })
      .from(supportMessages)
      .innerJoin(
        supportConversations,
        eq(supportConversations.id, supportMessages.conversationId),
      )
      .where(
        and(
          eq(supportConversations.userId, target),
          eq(supportMessages.id, data.messageId),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (!message) throw new Error('Message not found')
    const field =
      user.role === 'ADMIN' && target !== user.id
        ? supportConversations.adminReadAt
        : supportConversations.userReadAt
    await db
      .update(supportConversations)
      .set(
        user.role === 'ADMIN' && target !== user.id
          ? { adminReadAt: sql`greatest(${field}, ${message.createdAt})` }
          : { userReadAt: sql`greatest(${field}, ${message.createdAt})` },
      )
      .where(eq(supportConversations.id, message.conversationId))
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(
            notifications.href,
            user.role === 'ADMIN' && target !== user.id
              ? `/admin/support?userId=${target}`
              : '/support',
          ),
          lte(notifications.createdAt, message.createdAt),
        ),
      )
    return { success: true }
  })

export const sendSupportMessage = createServerFn({ method: 'POST' })
  .validator(
    targetInput.extend({
      requestId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const target = ownerId(user, data.userId)
    const fromAdmin = user.role === 'ADMIN' && target !== user.id
    return getDb().transaction(async (tx) => {
      const owner = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, target))
        .limit(1)
      if (!owner.length) throw new Error('User not found')
      await tx
        .insert(supportConversations)
        .values({ userId: target })
        .onConflictDoNothing()
      const conversation = await tx
        .select()
        .from(supportConversations)
        .where(eq(supportConversations.userId, target))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])
      const previous = await tx
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.id, data.requestId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (previous) {
        if (
          previous.authorUserId !== user.id ||
          previous.conversationId !== conversation.id ||
          previous.body !== data.body
        )
          throw new Error('Message request conflict')
        return { id: previous.id }
      }
      const recent = await tx
        .select({ createdAt: supportMessages.createdAt })
        .from(supportMessages)
        .where(
          and(
            eq(supportMessages.conversationId, conversation.id),
            eq(supportMessages.authorUserId, user.id),
          ),
        )
        .orderBy(desc(supportMessages.createdAt))
        .limit(1)
        .then((rows) => rows.at(0))
      if (recent && Date.now() - recent.createdAt.getTime() < 5000)
        throw new Error('Wait a few seconds before sending another message')
      await tx.insert(supportMessages).values({
        id: data.requestId,
        conversationId: conversation.id,
        authorUserId: user.id,
        fromAdmin,
        body: data.body,
      })
      await tx
        .update(supportConversations)
        .set({ updatedAt: new Date() })
        .where(eq(supportConversations.id, conversation.id))
      const recipients = fromAdmin
        ? [{ id: target }]
        : await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE')))
      for (const recipient of recipients.filter((item) => item.id !== user.id))
        await tx
          .insert(notifications)
          .values({
            userId: recipient.id,
            category: 'SYSTEM',
            title: fromAdmin
              ? 'New message from InvestFund Support'
              : 'New private support message',
            body: 'Open your support conversation to read and reply.',
            href: fromAdmin ? '/support' : `/admin/support?userId=${target}`,
            eventKey: `support:${data.requestId}:${recipient.id}`,
          })
          .onConflictDoNothing()
      if (fromAdmin)
        await tx.insert(auditLogs).values({
          actorUserId: user.id,
          action: 'SUPPORT_MESSAGE_SENT',
          entityType: 'support_conversation',
          entityId: conversation.id,
          after: { messageId: data.requestId, userId: target },
        })
      return { id: data.requestId }
    })
  })
