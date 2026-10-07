import { z } from 'zod'

export const communityEmoji = z.enum(['👍', '❤️', '🎯'])
export const communityImage = z
  .string()
  .max(1_400_000)
  .refine((value) => {
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    if (!match) return false
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.length > 1_000_000 || bytes.length < 12) return false
    if (bytes.toString('base64') !== match[2]) return false
    if (match[1] === 'png')
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (match[1] === 'jpeg')
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    return (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
  }, 'Use a PNG, JPEG or WebP image under 1 MB')

export const communityMessageInput = z
  .object({
    groupId: z.string().uuid(),
    requestId: z.string().uuid(),
    body: z.string().trim().max(2000),
    imageData: communityImage.optional(),
    replyToId: z.string().uuid().optional(),
  })
  .refine(
    (data) => Boolean(data.body || data.imageData),
    'Write a message or attach an image',
  )

export function canModerateCommunity(
  user: { id: string; role: string },
  group: { managerUserId: string | null },
) {
  return (
    user.role === 'ADMIN' ||
    (user.role === 'MANAGER' && group.managerUserId === user.id)
  )
}
