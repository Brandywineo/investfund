import { money } from './money'

export function reserveRequirement(
  withdrawableLiabilities: string,
  fixed: string,
  percent: string,
) {
  const percentageReserve = money(withdrawableLiabilities).mul(
    money(percent).div(100),
  )
  return money(fixed).greaterThan(percentageReserve)
    ? money(fixed)
    : percentageReserve
}

export function availableTreasuryLiquidity(
  hotWallet: string,
  withdrawalReserved: string,
  requiredReserve: string,
) {
  const available = money(hotWallet)
    .minus(withdrawalReserved)
    .minus(requiredReserve)
  return available.isNegative() ? money(0) : available
}
