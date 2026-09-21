import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { auditLogs, ledgerAccounts, sessions, users } from '#/db/schema'
import { hashPassword, verifyPassword } from './password'
import {
  createUserSession,
  destroyUserSession,
  getSessionUser,
} from './session'

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
})

export const register = createServerFn({ method: 'POST' })
  .validator(
    credentialsSchema.extend({ displayName: z.string().trim().min(2).max(80) }),
  )
  .handler(async ({ data }) => {
    const db = getDb()
    const existing = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${data.email}`)
        .limit(1)
    ).at(0)
    if (existing) throw new Error('An account already exists for this email')

    const user = await db.transaction(async (tx) => {
      const created = (
        await tx
          .insert(users)
          .values({
            email: data.email,
            displayName: data.displayName,
            passwordHash: await hashPassword(data.password),
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          })
          .returning({ id: users.id })
      ).at(0)
      if (!created) throw new Error('Account creation failed')

      await tx.insert(ledgerAccounts).values([
        {
          code: `USER:${created.id}:AVAILABLE`,
          name: `${data.displayName} available balance`,
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          ownerUserId: created.id,
        },
        {
          code: `USER:${created.id}:INVESTED`,
          name: `${data.displayName} invested balance`,
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          ownerUserId: created.id,
        },
      ])
      await tx.insert(auditLogs).values({
        actorUserId: created.id,
        action: 'USER_REGISTERED',
        entityType: 'user',
        entityId: created.id,
        after: { email: data.email },
      })
      return created
    })
    await createUserSession(user.id)
    return { success: true }
  })

export const login = createServerFn({ method: 'POST' })
  .validator(credentialsSchema)
  .handler(async ({ data }) => {
    const user = (
      await getDb()
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${data.email}`)
        .limit(1)
    ).at(0)

    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      throw new Error('Invalid email or password')
    }
    if (user.status !== 'ACTIVE') throw new Error('This account is not active')
    await createUserSession(user.id)
    return { success: true }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  await destroyUserSession()
  return { success: true }
})

export const changePassword = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(10).max(128),
        confirmPassword: z.string().min(10).max(128),
      })
      .refine((value) => value.newPassword === value.confirmPassword, {
        message: 'New passwords do not match',
      })
      .refine((value) => value.currentPassword !== value.newPassword, {
        message: 'Choose a password different from the current password',
      }),
  )
  .handler(async ({ data }) => {
    const sessionUser = await getSessionUser()
    if (!sessionUser) throw new Error('Authentication required')
    const user = await getDb()
      .select()
      .from(users)
      .where(sql`${users.id} = ${sessionUser.id}`)
      .limit(1)
      .then((rows) => rows.at(0))
    if (
      !user ||
      !(await verifyPassword(data.currentPassword, user.passwordHash))
    )
      throw new Error('Current password is incorrect')
    const passwordHash = await hashPassword(data.newPassword)
    await getDb().transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(sql`${users.id} = ${user.id}`)
      await tx
        .insert(auditLogs)
        .values({
          actorUserId: user.id,
          action: 'PASSWORD_CHANGED',
          entityType: 'user',
          entityId: user.id,
          after: { sessionsRevoked: true },
        })
      await tx.delete(sessions).where(sql`${sessions.userId} = ${user.id}`)
    })
    await destroyUserSession()
    return { success: true }
  })

export const currentUser = createServerFn({ method: 'GET' }).handler(() =>
  getSessionUser(),
)
