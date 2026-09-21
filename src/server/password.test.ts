import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password security', () => {
  it('hashes and verifies a password without storing plaintext', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored).not.toContain('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', stored)).resolves.toBe(false)
  })

  it('rejects malformed stored hashes', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false)
  })
})
