import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'

export interface EncryptedMnemonic {
  version: 1
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export function encryptMnemonic(
  mnemonic: string,
  password: string,
): EncryptedMnemonic {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(mnemonic, 'utf8'),
    cipher.final(),
  ])
  return {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptMnemonic(
  encrypted: EncryptedMnemonic,
  password: string,
) {
  const salt = Buffer.from(encrypted.salt, 'base64')
  const iv = Buffer.from(encrypted.iv, 'base64')
  const key = scryptSync(password, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
