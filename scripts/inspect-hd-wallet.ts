import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { HDNodeWallet } from 'ethers'
import type { EncryptedMnemonic } from '../src/server/hd-wallet-crypto'
import { decryptMnemonic } from '../src/server/hd-wallet-crypto'

const walletFileInput = process.argv[2] || process.env.HD_WALLET_FILE
const selector = process.argv[3] || 'hot'
const password = process.env.HD_WALLET_PASSWORD
if (!walletFileInput) throw new Error('Provide the encrypted wallet file path')
if (!password) throw new Error('HD_WALLET_PASSWORD is required')
const walletFile = resolve(walletFileInput)

const encrypted = JSON.parse(
  await readFile(walletFile, 'utf8'),
) as EncryptedMnemonic
const mnemonic = decryptMnemonic(encrypted, password)
const root = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'")

let relativePath: string
if (selector === 'hot') relativePath = '1/0'
else if (selector === 'gas') relativePath = '1/1'
else if (/^deposit:\d+$/.test(selector)) {
  const index = Number(selector.slice('deposit:'.length))
  if (!Number.isSafeInteger(index) || index < 1)
    throw new Error('Deposit index must be a positive safe integer')
  relativePath = `0/${index}`
} else {
  throw new Error('Selector must be hot, gas, or deposit:<index>')
}

const wallet = root.derivePath(relativePath)
console.log(`Role: ${selector}`)
console.log(`Path: m/44'/60'/0'/${relativePath}`)
console.log(`Address: ${wallet.address}`)

if (process.argv.includes('--export-private-key')) {
  if (process.env.ALLOW_PRIVATE_KEY_EXPORT !== 'I_UNDERSTAND_THE_RISK')
    throw new Error(
      'Set ALLOW_PRIVATE_KEY_EXPORT=I_UNDERSTAND_THE_RISK for emergency export',
    )
  console.error(
    'WARNING: private key follows. Run only on an offline recovery machine.',
  )
  console.log(`Private key: ${wallet.privateKey}`)
}
