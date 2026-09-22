import Decimal from 'decimal.js'
import { money } from './money'

export function calculateWithdrawal(amount: string, feePercent: string) {
  const gross = money(amount)
  const rate = new Decimal(feePercent)
  if (gross.lte(0)) throw new Error('Withdrawal amount must be positive')
  if (rate.lt(0) || rate.gte(100))
    throw new Error('Withdrawal fee must be between 0% and 100%')
  const fee = money(gross.mul(rate).div(100))
  const net = money(gross.minus(fee))
  if (net.lte(0))
    throw new Error('Withdrawal amount after fees must be positive')
  return { gross, rate, fee, net }
}
