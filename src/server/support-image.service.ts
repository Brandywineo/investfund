import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { supportMessages, supportConversations } from '#/db/schema'
import { getSessionUser } from './session'

export async function getSupportImageResponse(messageId: string) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  }
  const user = await getSessionUser()
  if (!user)
    return new Response('Authentication required', { status: 401, headers })
  if (!z.string().uuid().safeParse(messageId).success)
    return new Response('Not found', { status: 404, headers })
  const message = await getDb()
    .select({ imageData: supportMessages.imageData })
    .from(supportMessages)
    .innerJoin(
      supportConversations,
      eq(supportConversations.id, supportMessages.conversationId),
    )
    .where(
      and(
        eq(supportMessages.id, messageId),
        user.role === 'ADMIN'
          ? undefined
          : eq(supportConversations.userId, user.id),
      ),
    )
    .limit(1)
    .then((rows) => rows.at(0))
  const match = message?.imageData?.match(
    /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/,
  )
  if (!match) return new Response('Not found', { status: 404, headers })
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { ...headers, 'Content-Type': match[1] },
  })
}
