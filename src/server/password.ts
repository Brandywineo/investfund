import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltEncoded, hashEncoded] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltEncoded || !hashEncoded) return false

  const salt = Buffer.from(saltEncoded, 'base64url')
  const expected = Buffer.from(hashEncoded, 'base64url')
  const actual = (await scrypt(password, salt, expected.length)) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
