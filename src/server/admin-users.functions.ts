import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { auditLogs, users } from '#/db/schema'
import { getSessionUser } from './session'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user || user.role !== 'ADMIN') throw new Error('Administrator access required')
  return user
}

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  return getDb().select({ id: users.id, displayName: users.displayName, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt)).limit(250)
})

export const updateUserAccess = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().uuid(), role: z.enum(['USER', 'MANAGER', 'ADMIN']), status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    if (admin.id === data.userId && (data.role !== 'ADMIN' || data.status !== 'ACTIVE')) {
      throw new Error('You cannot remove or suspend your own administrator access')
    }

    await getDb().transaction(async (tx) => {
      const target = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, data.userId)).limit(1).then((rows) => rows.at(0))
      if (!target) throw new Error('User not found')
      if (target.role === 'ADMIN' && target.status === 'ACTIVE' && (data.role !== 'ADMIN' || data.status !== 'ACTIVE')) {
        const activeAdmins = await tx.select({ value: count() }).from(users).where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE'))).then((rows) => rows.at(0)?.value ?? 0)
        if (activeAdmins <= 1) throw new Error('At least one active administrator is required')
      }
      await tx.update(users).set({ role: data.role, status: data.status, updatedAt: new Date() }).where(eq(users.id, data.userId))
      await tx.insert(auditLogs).values({ actorUserId: admin.id, action: 'USER_ACCESS_UPDATED', entityType: 'user', entityId: data.userId, before: target, after: { role: data.role, status: data.status } })
    })
    return { success: true }
  })
