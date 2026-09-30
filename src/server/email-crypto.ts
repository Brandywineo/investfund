import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function encryptionKey(): Buffer {
  const encoded = process.env.EMAIL_SETTINGS_ENCRYPTION_KEY
  if (!encoded) {
    throw new Error('EMAIL_SETTINGS_ENCRYPTION_KEY is not configured')
  }
  const key = Buffer.from(encoded, 'base64url')
  if (key.length !== 32) {
    throw new Error(
      'EMAIL_SETTINGS_ENCRYPTION_KEY must be a 32-byte base64url value',
    )
  }
  return key
}

export function encryptEmailSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptEmailSecret(value: string): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.')
  if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Stored email credential is invalid')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivEncoded, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
