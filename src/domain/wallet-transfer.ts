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
  if (input.destinationType === 'INTERNAL' && !input.destinationRole)
    throw new Error('An internal transfer requires a platform destination')
  if (input.destinationType === 'EXTERNAL' && input.destinationRole)
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
