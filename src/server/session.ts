import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import {
  deleteCookie,
  getCookie,
  setCookie,
} from '@tanstack/react-start/server'
import { getDb } from '#/db'
import { sessions, users } from '#/db/schema'

const COOKIE_NAME = 'investfund_session'
const SESSION_DAYS = 30

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createUserSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await getDb()
    .insert(sessions)
    .values({ userId, tokenHash: hashToken(token), expiresAt })
  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function destroyUserSession(): Promise<void> {
  const token = getCookie(COOKIE_NAME)
  if (token)
    await getDb()
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
  deleteCookie(COOKIE_NAME, { path: '/' })
}

export async function getSessionUser() {
  const token = getCookie(COOKIE_NAME)
  if (!token) return null

  const result = (
    await getDb()
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
  ).at(0)
  return result?.status === 'ACTIVE' ? result : null
}
