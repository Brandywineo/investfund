import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export const MONEY_SCALE = 8

export function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE)
}

export function formatUsdt(value: Decimal.Value): string {
  return money(value).toFixed(2)
}
