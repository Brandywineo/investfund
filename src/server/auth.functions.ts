import { createServerFn } from '@tanstack/react-start'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import {
  auditLogs,
  emailOutbox,
  emailVerificationTokens,
  ledgerAccounts,
  passwordResetTokens,
  sessions,
  users,
} from '#/db/schema'
import { hashPassword, verifyPassword } from './password'
import { attachReferrer, ensureReferralCode } from './referral.service'
import { notifyUser } from './notification.service'
import { createEmailToken, hashEmailToken } from './email-token'
import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from './email-template'
import { appOrigin, getEmailSettings, queueEmail } from './email.service'
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
    credentialsSchema.extend({
      displayName: z.string().trim().min(2).max(80),
      referralCode: z.string().trim().max(32).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const db = getDb()
    const mailSettings = await getEmailSettings()
    const verificationRequired = Boolean(
      mailSettings?.enabled && mailSettings.verificationRequired,
    )
    const verification = verificationRequired ? createEmailToken() : null
    const verificationMessage = verification
      ? verificationEmail(
          data.displayName,
          `${appOrigin()}/verify-email?token=${encodeURIComponent(verification.token)}`,
        )
      : null
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
            status: verificationRequired ? 'PENDING_VERIFICATION' : 'ACTIVE',
            emailVerifiedAt: verificationRequired ? null : new Date(),
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
      const ownCode = await ensureReferralCode(tx, created.id)
      const sponsor = data.referralCode
        ? await attachReferrer(tx, created.id, data.referralCode)
        : null
      if (verification && verificationMessage) {
        const expiryMinutes = mailSettings?.verificationExpiryMinutes ?? 1440
        await tx.insert(emailVerificationTokens).values({
          userId: created.id,
          tokenHash: verification.hash,
          expiresAt: new Date(Date.now() + expiryMinutes * 60_000),
        })
        await tx.insert(emailOutbox).values({
          recipient: data.email,
          category: 'EMAIL_VERIFICATION',
          ...verificationMessage,
        })
      }
      await tx.insert(auditLogs).values({
        actorUserId: created.id,
        action: 'USER_REGISTERED',
        entityType: 'user',
        entityId: created.id,
        after: {
          email: data.email,
          referralCode: ownCode.code,
          referredBy: sponsor?.userId ?? null,
        },
      })
      return { ...created, sponsorUserId: sponsor?.userId ?? null }
    })
    if (!verificationRequired) await createUserSession(user.id)
    if (user.sponsorUserId) {
      await Promise.allSettled([
        notifyUser({
          userId: user.sponsorUserId,
          category: 'REFERRAL',
          title: 'A new direct referral joined',
          body: 'Your new direct referral will begin generating commission after funding and starting an investment.',
          href: '/referrals',
          eventKey: `referral:${user.id}:joined`,
        }),
      ])
    }
    return { success: true, verificationRequired, email: data.email }
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
    if (user.status === 'PENDING_VERIFICATION') {
      throw new Error('Please verify your email address before signing in')
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
      await tx.insert(auditLogs).values({
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

const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
})

export const resendVerificationEmail = createServerFn({ method: 'POST' })
  .validator(emailOnlySchema)
  .handler(async ({ data }) => {
    const settings = await getEmailSettings()
    if (!settings?.enabled || !settings.verificationRequired) {
      return { success: true }
    }
    const user = await getDb()
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${data.email}`)
      .limit(1)
      .then((rows) => rows.at(0))
    if (!user || user.status !== 'PENDING_VERIFICATION') {
      return { success: true }
    }
    const recent = await getDb()
      .select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          gt(emailVerificationTokens.createdAt, new Date(Date.now() - 60_000)),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (recent)
      throw new Error('Please wait one minute before requesting again')

    const token = createEmailToken()
    const message = verificationEmail(
      user.displayName,
      `${appOrigin()}/verify-email?token=${encodeURIComponent(token.token)}`,
    )
    await getDb().transaction(async (tx) => {
      await tx
        .update(emailVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(emailVerificationTokens.userId, user.id),
            isNull(emailVerificationTokens.consumedAt),
          ),
        )
      await tx.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: token.hash,
        expiresAt: new Date(
          Date.now() + settings.verificationExpiryMinutes * 60_000,
        ),
      })
      await tx.insert(emailOutbox).values({
        recipient: user.email,
        category: 'EMAIL_VERIFICATION',
        ...message,
      })
    })
    return { success: true }
  })

export const verifyEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().min(20).max(500) }))
  .handler(async ({ data }) => {
    const tokenHash = hashEmailToken(data.token)
    const verifiedUserId = await getDb().transaction(async (tx) => {
      const token = await tx
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, tokenHash),
            isNull(emailVerificationTokens.consumedAt),
            gt(emailVerificationTokens.expiresAt, new Date()),
          ),
        )
        .limit(1)
        .then((rows) => rows.at(0))
      if (!token)
        throw new Error('This verification link is invalid or expired')
      await tx
        .update(emailVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(eq(emailVerificationTokens.id, token.id))
      await tx
        .update(users)
        .set({
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, token.userId))
      await tx.insert(auditLogs).values({
        actorUserId: token.userId,
        action: 'EMAIL_VERIFIED',
        entityType: 'user',
        entityId: token.userId,
      })
      return token.userId
    })
    await createUserSession(verifiedUserId)
    return { success: true }
  })

export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator(emailOnlySchema)
  .handler(async ({ data }) => {
    const settings = await getEmailSettings()
    if (!settings?.enabled) return { success: true }
    const user = await getDb()
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${data.email}`)
      .limit(1)
      .then((rows) => rows.at(0))
    if (!user || user.status === 'SUSPENDED') return { success: true }

    const recent = await getDb()
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.createdAt, new Date(Date.now() - 60_000)),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    if (recent) return { success: true }

    const token = createEmailToken()
    const message = passwordResetEmail(
      user.displayName,
      `${appOrigin()}/reset-password?token=${encodeURIComponent(token.token)}`,
    )
    await getDb().transaction(async (tx) => {
      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.consumedAt),
          ),
        )
      await tx.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + settings.resetExpiryMinutes * 60_000),
      })
      await tx.insert(emailOutbox).values({
        recipient: user.email,
        category: 'PASSWORD_RESET',
        ...message,
      })
    })
    return { success: true }
  })

export const resetPassword = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        token: z.string().min(20).max(500),
        password: z.string().min(10).max(128),
        confirmPassword: z.string().min(10).max(128),
      })
      .refine((value) => value.password === value.confirmPassword, {
        message: 'Passwords do not match',
      }),
  )
  .handler(async ({ data }) => {
    const tokenHash = hashEmailToken(data.token)
    const changedUser = await getDb().transaction(async (tx) => {
      const token = await tx
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .limit(1)
        .then((rows) => rows.at(0))
      if (!token)
        throw new Error('This password-reset link is invalid or expired')
      const user = await tx
        .select()
        .from(users)
        .where(eq(users.id, token.userId))
        .limit(1)
        .then((rows) => rows.at(0))
      if (!user) throw new Error('Account was not found')
      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(eq(passwordResetTokens.id, token.id))
      await tx
        .update(users)
        .set({
          passwordHash: await hashPassword(data.password),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
      await tx.delete(sessions).where(eq(sessions.userId, user.id))
      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'user',
        entityId: user.id,
        after: { sessionsRevoked: true },
      })
      return user
    })
    const message = passwordChangedEmail(changedUser.displayName)
    await queueEmail({
      recipient: changedUser.email,
      category: 'PASSWORD_CHANGED',
      ...message,
    }).catch(() => undefined)
    return { success: true }
  })
