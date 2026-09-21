import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { HDNodeWallet, Mnemonic } from 'ethers'
import { encryptMnemonic } from '../src/server/hd-wallet-crypto'

const output = resolve(process.argv[2] || './hd-wallet.json')
const password = process.env.HD_WALLET_PASSWORD
if (!password || password.length < 16)
  throw new Error('HD_WALLET_PASSWORD must contain at least 16 characters')

const mnemonic = Mnemonic.fromEntropy(
  crypto.getRandomValues(new Uint8Array(32)),
)
const encrypted = encryptMnemonic(mnemonic.phrase, password)
const root = HDNodeWallet.fromPhrase(mnemonic.phrase, undefined, "m/44'/60'/0'")

await mkdir(dirname(output), { recursive: true, mode: 0o700 })
await writeFile(output, `${JSON.stringify(encrypted, null, 2)}\n`, {
  mode: 0o600,
})

console.log(`Encrypted wallet written to ${output}`)
console.log(`Hot wallet: ${root.derivePath('1/0').address}`)
console.log(`Gas wallet: ${root.derivePath('1/1').address}`)
console.log(
  'RECOVERY MNEMONIC — write this offline and never place it in .env:',
)
console.log(mnemonic.phrase)
