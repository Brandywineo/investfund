import { describe, expect, it } from 'vitest'
import { decryptMnemonic, encryptMnemonic } from './hd-wallet-crypto'

describe('HD wallet encryption', () => {
  it('round-trips a mnemonic with authenticated encryption', () => {
    const phrase = 'test test test test test test test test test test test junk'
    const encrypted = encryptMnemonic(phrase, 'a sufficiently long password')

    expect(encrypted.ciphertext).not.toContain('test')
    expect(decryptMnemonic(encrypted, 'a sufficiently long password')).toBe(
      phrase,
    )
  })

  it('rejects an incorrect password', () => {
    const encrypted = encryptMnemonic(
      'test test test test test test test test test test test junk',
      'correct sufficiently long password',
    )

    expect(() => decryptMnemonic(encrypted, 'incorrect password')).toThrow()
  })
})
