import { money } from './money'

export const REFERRAL_RATES = ['1', '0.5', '0.24'] as const

export function referralCommission(profit: string, level: 1 | 2 | 3) {
  return money(profit)
    .mul(REFERRAL_RATES[level - 1])
    .div(100)
    .toDecimalPlaces(8)
}
