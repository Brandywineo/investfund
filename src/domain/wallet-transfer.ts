import { money } from './money'

export type PlatformWalletRole = 'HOT_WITHDRAWAL' | 'SWEEP_GAS'
export type WalletTransferAsset = 'BNB' | 'USDT'
export type WalletTransferDestination = 'INTERNAL' | 'EXTERNAL'

export function validateWalletTransferRoute(input: {
  sourceRole: PlatformWalletRole
  destinationType: WalletTransferDestination
  destinationRole?: PlatformWalletRole | null
  asset: WalletTransferAsset
}) {
  if (input.sourceRole === 'SWEEP_GAS') {
    if (
      input.asset !== 'BNB' ||
      input.destinationType !== 'INTERNAL' ||
      input.destinationRole !== 'HOT_WITHDRAWAL'
    )
      throw new Error(
        'The sweep-fee wallet can only send BNB to the hot wallet',
      )
    return
  }
  if (input.destinationType === 'INTERNAL') {
    if (input.asset !== 'BNB' || input.destinationRole !== 'SWEEP_GAS')
      throw new Error(
        'Internal hot-wallet transfers must send BNB to sweep gas',
      )
    return
  }
  if (input.destinationRole)
    throw new Error(
      'An external transfer cannot have a platform destination role',
    )
}

export function ensureTransferBalance(input: {
  asset: WalletTransferAsset
  amount: string
  assetBalance: string
  nativeBalance: string
  estimatedFeeBnb: string
}) {
  const amount = money(input.amount)
  const fee = money(input.estimatedFeeBnb)
  if (!amount.isPositive()) throw new Error('Transfer amount must be positive')
  if (input.asset === 'BNB') {
    if (amount.add(fee).greaterThan(input.nativeBalance))
      throw new Error('BNB balance is insufficient after reserving network gas')
  } else {
    if (amount.greaterThan(input.assetBalance))
      throw new Error('USDT balance is insufficient')
    if (fee.greaterThan(input.nativeBalance))
      throw new Error('Source wallet has insufficient BNB for network gas')
  }
}
