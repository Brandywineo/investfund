import { createServerFn } from '@tanstack/react-start'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  communityGroups,
  communityMembers,
  communityMessages,
  communityReactions,
  communityReports,
  notifications,
  users,
} from '#/db/schema'
import {
  canModerateCommunity,
  communityEmoji,
  communityMessageInput,
} from '#/domain/community'
import { getSessionUser } from './session'

async function requireUser() {
  const user = await getSessionUser()
  if (!user) throw new Error('Authentication required')
  return user
}

async function requireGroup(groupId: string) {
  const group = await getDb()
    .select()
    .from(communityGroups)
    .where(eq(communityGroups.id, groupId))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!group) throw new Error('Community room not found')
  return group
}

export const getCommunity = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const groups = await getDb()
      .select({
        id: communityGroups.id,
        name: communityGroups.name,
        description: communityGroups.description,
        announcementsOnly: communityGroups.announcementsOnly,
        managerUserId: communityGroups.managerUserId,
        joinedAt: communityMembers.joinedAt,
        mutedUntil: communityMembers.mutedUntil,
        memberCount: sql<number>`(select count(*)::int from community_members cm where cm.group_id = ${communityGroups.id})`,
      })
      .from(communityGroups)
      .leftJoin(
        communityMembers,
        and(
          eq(communityMembers.groupId, communityGroups.id),
          eq(communityMembers.userId, user.id),
        ),
      )
      .orderBy(
        desc(communityGroups.announcementsOnly),
        asc(communityGroups.createdAt),
      )
    const managers =
      user.role === 'ADMIN'
        ? await getDb()
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(and(eq(users.role, 'MANAGER'), eq(users.status, 'ACTIVE')))
        : []
    return {
      user,
      managers,
      groups: groups.map((group) => ({
        ...group,
        canModerate: canModerateCommunity(user, group),
      })),
    }
  },
)

export const joinCommunity = createServerFn({ method: 'POST' })
  .validator(z.object({ groupId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await requireGroup(data.groupId)
    await getDb()
      .insert(communityMembers)
      .values({ groupId: data.groupId, userId: user.id })
      .onConflictDoNothing()
    return { success: true }
  })

export const getCommunityRoom = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      groupId: z.string().uuid(),
      before: z
        .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const group = await requireGroup(data.groupId)
    const db = getDb()
    const fields = {
      id: communityMessages.id,
      authorUserId: communityMessages.authorUserId,
      body: communityMessages.body,
      hasImage: sql<boolean>`${communityMessages.imageData} is not null`,
      replyToId: communityMessages.replyToId,
      pinned: communityMessages.pinned,
      createdAt: communityMessages.createdAt,
      authorName: users.displayName,
      authorRole: users.role,
      replyBody: sql<
        string | null
      >`(select cm.body from community_messages cm where cm.id = ${communityMessages.replyToId} and cm.group_id = ${communityMessages.groupId} and cm.hidden_at is null)`,
    }
    const visible = and(
      eq(communityMessages.groupId, data.groupId),
      isNull(communityMessages.hiddenAt),
    )
    const rows = await db
      .select(fields)
      .from(communityMessages)
      .innerJoin(users, eq(users.id, communityMessages.authorUserId))
      .where(
        and(
          visible,
          data.before
            ? or(
                lt(
                  communityMessages.createdAt,
                  new Date(data.before.createdAt),
                ),
                and(
                  eq(
                    communityMessages.createdAt,
                    new Date(data.before.createdAt),
                  ),
                  lt(communityMessages.id, data.before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(communityMessages.createdAt), desc(communityMessages.id))
      .limit(41)
    const pinned = await db
      .select(fields)
      .from(communityMessages)
      .innerJoin(users, eq(users.id, communityMessages.authorUserId))
      .where(and(visible, eq(communityMessages.pinned, true)))
      .orderBy(desc(communityMessages.createdAt))
      .limit(20)
    const page = rows.slice(0, 40)
    const ids = [...new Set([...page, ...pinned].map((row) => row.id))]
    const reactions = ids.length
      ? await db
          .select()
          .from(communityReactions)
          .where(inArray(communityReactions.messageId, ids))
      : []
    const decorate = (row: (typeof page)[number]) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      reactions: ['👍', '❤️', '🎯'].map((emoji) => ({
        emoji,
        count: reactions.filter(
          (r) => r.messageId === row.id && r.emoji === emoji,
        ).length,
        mine: reactions.some(
          (r) =>
            r.messageId === row.id && r.emoji === emoji && r.userId === user.id,
        ),
      })),
    })
    const moderator = canModerateCommunity(user, group)
    const reports = moderator
      ? await db
          .select({
            id: communityReports.id,
            messageId: communityReports.messageId,
            reason: communityReports.reason,
            body: communityMessages.body,
            authorUserId: communityMessages.authorUserId,
          })
          .from(communityReports)
          .innerJoin(
            communityMessages,
            eq(communityMessages.id, communityReports.messageId),
          )
          .where(
            and(
              eq(communityMessages.groupId, data.groupId),
              isNull(communityReports.resolvedAt),
            ),
          )
          .orderBy(asc(communityReports.createdAt))
          .limit(100)
      : []
    const members = moderator
      ? await db
          .select({
            id: users.id,
            name: users.displayName,
            mutedUntil: communityMembers.mutedUntil,
          })
          .from(communityMembers)
          .innerJoin(users, eq(users.id, communityMembers.userId))
          .where(eq(communityMembers.groupId, data.groupId))
          .orderBy(asc(communityMembers.joinedAt))
          .limit(250)
      : []
    const last = page.at(-1)
    return {
      messages: page.reverse().map(decorate),
      pinned: pinned.map(decorate),
      reports,
      members,
      olderCursor:
        rows.length > 40 && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null,
    }
  })

export const sendCommunityMessage = createServerFn({ method: 'POST' })
  .validator(communityMessageInput)
  .handler(async ({ data }) => {
    const user = await requireUser()
    return getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`community:${user.id}`}))`,
      )
      const previous = await tx
        .select()
        .from(communityMessages)
        .where(eq(communityMessages.id, data.requestId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (previous) {
        if (
          previous.authorUserId !== user.id ||
          previous.groupId !== data.groupId
        )
          throw new Error('Message request conflict')
        return { id: previous.id }
      }
      const group = await tx
        .select()
        .from(communityGroups)
        .where(eq(communityGroups.id, data.groupId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (!group) throw new Error('Community room not found')
      if (group.announcementsOnly && !canModerateCommunity(user, group))
        throw new Error('Only room moderators can publish announcements')
      const member = await tx
        .select()
        .from(communityMembers)
        .where(
          and(
            eq(communityMembers.groupId, data.groupId),
            eq(communityMembers.userId, user.id),
          ),
        )
        .limit(1)
        .then((rows) => rows.at(0))
      if (!member) throw new Error('Join the room before posting')
      if (member.mutedUntil && member.mutedUntil > new Date())
        throw new Error(
          'You are muted in this room until ' + member.mutedUntil.toISOString(),
        )
      const recent = await tx
        .select({ id: communityMessages.id })
        .from(communityMessages)
        .where(
          and(
            eq(communityMessages.authorUserId, user.id),
            gt(communityMessages.createdAt, new Date(Date.now() - 5000)),
          ),
        )
        .limit(1)
      if (recent.length)
        throw new Error('Wait a few seconds before sending another message')
      if (data.replyToId) {
        const reply = await tx
          .select({ id: communityMessages.id })
          .from(communityMessages)
          .where(
            and(
              eq(communityMessages.id, data.replyToId),
              eq(communityMessages.groupId, data.groupId),
              isNull(communityMessages.hiddenAt),
            ),
          )
          .limit(1)
        if (!reply.length)
          throw new Error('Reply target is no longer available in this room')
      }
      await tx.insert(communityMessages).values({
        id: data.requestId,
        groupId: data.groupId,
        authorUserId: user.id,
        body: data.body,
        imageData: data.imageData,
        replyToId: data.replyToId,
      })
      if (group.announcementsOnly) {
        const recipients = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.status, 'ACTIVE'))
        const items = recipients
          .filter((recipient) => recipient.id !== user.id)
          .map((recipient) => ({
            userId: recipient.id,
            category: 'SYSTEM' as const,
            title: `Community: ${group.name}`,
            body:
              data.body.slice(0, 250) ||
              'A new image announcement was published.',
            href: '/community',
            eventKey: `community:${data.requestId}:${recipient.id}`,
          }))
        for (let offset = 0; offset < items.length; offset += 500)
          await tx
            .insert(notifications)
            .values(items.slice(offset, offset + 500))
            .onConflictDoNothing()
      }
      return { id: data.requestId }
    })
  })

export const reactToCommunityMessage = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      messageId: z.string().uuid(),
      emoji: communityEmoji,
      active: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const message = await getDb()
      .select({ id: communityMessages.id, groupId: communityMessages.groupId })
      .from(communityMessages)
      .where(
        and(
          eq(communityMessages.id, data.messageId),
          isNull(communityMessages.hiddenAt),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (!message) throw new Error('Message not found')
    const member = await getDb()
      .select()
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.groupId, message.groupId),
          eq(communityMembers.userId, user.id),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (!member || (member.mutedUntil && member.mutedUntil > new Date()))
      throw new Error(
        'Join the room and wait until any mute ends before reacting',
      )
    if (data.active)
      await getDb()
        .insert(communityReactions)
        .values({
          messageId: data.messageId,
          userId: user.id,
          emoji: data.emoji,
        })
        .onConflictDoNothing()
    else
      await getDb()
        .delete(communityReactions)
        .where(
          and(
            eq(communityReactions.messageId, data.messageId),
            eq(communityReactions.userId, user.id),
            eq(communityReactions.emoji, data.emoji),
          ),
        )
    return { success: true }
  })

export const reportCommunityMessage = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      messageId: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const message = await getDb()
      .select({ id: communityMessages.id })
      .from(communityMessages)
      .where(
        and(
          eq(communityMessages.id, data.messageId),
          isNull(communityMessages.hiddenAt),
        ),
      )
      .limit(1)
    if (!message.length) throw new Error('Message not found')
    await getDb()
      .insert(communityReports)
      .values({
        messageId: data.messageId,
        reporterUserId: user.id,
        reason: data.reason,
      })
      .onConflictDoNothing()
    return { success: true }
  })

export const moderateCommunity = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      groupId: z.string().uuid(),
      action: z.enum([
        'HIDE',
        'PIN',
        'UNPIN',
        'MUTE',
        'UNMUTE',
        'DISMISS_REPORT',
      ]),
      targetId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const group = await requireGroup(data.groupId)
    const moderator = canModerateCommunity(user, group)
    await getDb().transaction(async (tx) => {
      if (['HIDE', 'PIN', 'UNPIN'].includes(data.action)) {
        const message = await tx
          .select()
          .from(communityMessages)
          .where(
            and(
              eq(communityMessages.id, data.targetId),
              eq(communityMessages.groupId, data.groupId),
            ),
          )
          .limit(1)
          .then((rows) => rows.at(0))
        if (!message) throw new Error('Message not found')
        if (
          !moderator &&
          !(data.action === 'HIDE' && message.authorUserId === user.id)
        )
          throw new Error('Room moderator access required')
        await tx
          .update(communityMessages)
          .set(
            data.action === 'HIDE'
              ? { hiddenAt: new Date(), pinned: false, updatedAt: new Date() }
              : { pinned: data.action === 'PIN', updatedAt: new Date() },
          )
          .where(eq(communityMessages.id, data.targetId))
        if (data.action === 'HIDE')
          await tx
            .update(communityReports)
            .set({ resolvedAt: new Date() })
            .where(eq(communityReports.messageId, data.targetId))
      } else {
        if (!moderator) throw new Error('Room moderator access required')
        if (data.action === 'DISMISS_REPORT') {
          const report = await tx
            .select({ id: communityReports.id })
            .from(communityReports)
            .innerJoin(
              communityMessages,
              eq(communityMessages.id, communityReports.messageId),
            )
            .where(
              and(
                eq(communityReports.id, data.targetId),
                eq(communityMessages.groupId, data.groupId),
              ),
            )
            .limit(1)
          if (!report.length) throw new Error('Report not found in this room')
          await tx
            .update(communityReports)
            .set({ resolvedAt: new Date() })
            .where(eq(communityReports.id, data.targetId))
        } else {
          const target = await tx
            .select({ role: users.role })
            .from(users)
            .where(eq(users.id, data.targetId))
            .limit(1)
            .then((rows) => rows.at(0))
          if (
            !target ||
            target.role === 'ADMIN' ||
            (target.role === 'MANAGER' && user.role !== 'ADMIN')
          )
            throw new Error('You cannot mute this account')
          const updated = await tx
            .update(communityMembers)
            .set({
              mutedUntil:
                data.action === 'MUTE'
                  ? new Date(Date.now() + 24 * 60 * 60 * 1000)
                  : null,
            })
            .where(
              and(
                eq(communityMembers.groupId, data.groupId),
                eq(communityMembers.userId, data.targetId),
              ),
            )
            .returning({ id: communityMembers.userId })
          if (!updated.length) throw new Error('Member not found in this room')
        }
      }
      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: `COMMUNITY_${data.action}`,
        entityType: 'community',
        entityId: data.targetId,
        after: { groupId: data.groupId, action: data.action },
      })
    })
    return { success: true }
  })

export const createCommunityGroup = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().trim().min(3).max(80),
      description: z.string().trim().max(300),
      announcementsOnly: z.boolean(),
      managerUserId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (user.role !== 'ADMIN') throw new Error('Administrator access required')
    return getDb().transaction(async (tx) => {
      if (data.managerUserId) {
        const manager = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, data.managerUserId),
              eq(users.role, 'MANAGER'),
              eq(users.status, 'ACTIVE'),
            ),
          )
          .limit(1)
        if (!manager.length) throw new Error('Select an active manager')
      }
      const group = await tx
        .insert(communityGroups)
        .values(data)
        .returning()
        .then((rows) => rows[0])
      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'COMMUNITY_GROUP_CREATED',
        entityType: 'community_group',
        entityId: group.id,
        after: data,
      })
      return { id: group.id }
    })
  })
