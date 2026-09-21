import Decimal from 'decimal.js'
import { money } from './money'

export interface AccrualResult {
  openingBalance: Decimal
  ratePercent: Decimal
  amount: Decimal
  closingBalance: Decimal
}

export function calculateDailyAccrual(
  balance: Decimal.Value,
  dailyRatePercent: Decimal.Value,
): AccrualResult {
  const openingBalance = money(balance)
  const ratePercent = new Decimal(dailyRatePercent)

  if (openingBalance.isNegative()) throw new Error('Balance cannot be negative')
  if (ratePercent.isNegative()) throw new Error('Daily rate cannot be negative')

  const amount = money(openingBalance.mul(ratePercent).div(100))
  return {
    openingBalance,
    ratePercent,
    amount,
    closingBalance: money(openingBalance.add(amount)),
  }
}

export function validateInvestmentAmount(
  amount: Decimal.Value,
  minimum: Decimal.Value,
  maximum: Decimal.Value,
): Decimal {
  const normalized = money(amount)
  const min = money(minimum)
  const max = money(maximum)

  if (min.greaterThan(max)) throw new Error('Investment limits are invalid')
  if (normalized.lessThan(min) || normalized.greaterThan(max)) {
    throw new Error(`Investment must be between ${min.toFixed(2)} and ${max.toFixed(2)} USDT`)
  }
  return normalized
}

export function accrualIdempotencyKey(investmentId: string, accrualDate: string): string {
  return `daily-accrual:${investmentId}:${accrualDate.slice(0, 10)}`
}
