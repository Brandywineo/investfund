import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db'
import { supportMessages, supportConversations } from '#/db/schema'
import { getSessionUser } from './session'

export async function getSupportFileResponse(messageId: string, index: string) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  }
  const user = await getSessionUser()
  if (!user)
    return new Response('Authentication required', { status: 401, headers })
  if (!z.string().uuid().safeParse(messageId).success || !/^[0-4]$/.test(index))
    return new Response('Not found', { status: 404, headers })
  const message = await getDb()
    .select({ attachments: supportMessages.attachments })
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
  const file = message?.attachments[Number(index)]
  if (!file) return new Response('Not found', { status: 404, headers })
  const disposition = file.mime.startsWith('image/') ? 'inline' : 'attachment'
  return new Response(Buffer.from(file.data, 'base64'), {
    headers: {
      ...headers,
      'Content-Type': file.mime,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
    },
  })
}
