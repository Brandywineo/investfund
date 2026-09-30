import { createHash, randomBytes } from 'node:crypto'

export function createEmailToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashEmailToken(token) }
}

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
