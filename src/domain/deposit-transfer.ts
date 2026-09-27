import { parseUnits } from 'ethers'

export type DepositTransferDisposition = 'ZERO_VALUE' | 'DUST' | 'CREDIT'

export function classifyDepositTransfer(input: {
  rawValue: bigint
  tokenDecimals: number
  minimumCreditedAmount: string
}): DepositTransferDisposition {
  if (input.rawValue <= 0n) return 'ZERO_VALUE'

  const minimumRawValue = parseUnits(
    input.minimumCreditedAmount,
    input.tokenDecimals,
  )
  return input.rawValue < minimumRawValue ? 'DUST' : 'CREDIT'
}
