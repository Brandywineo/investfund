import Decimal from 'decimal.js'
import { money } from './money'

export type EntrySide = 'DEBIT' | 'CREDIT'

export interface LedgerLine {
  accountId: string
  side: EntrySide
  amount: Decimal.Value
}

export function assertBalanced(lines: ReadonlyArray<LedgerLine>): void {
  if (lines.length < 2)
    throw new Error('A ledger transaction needs at least two entries')

  const debit = lines
    .filter((line) => line.side === 'DEBIT')
    .reduce((sum, line) => sum.add(money(line.amount)), new Decimal(0))
  const credit = lines
    .filter((line) => line.side === 'CREDIT')
    .reduce((sum, line) => sum.add(money(line.amount)), new Decimal(0))

  if (lines.some((line) => money(line.amount).lessThanOrEqualTo(0))) {
    throw new Error('Ledger entry amounts must be positive')
  }
  if (!debit.equals(credit)) {
    throw new Error(
      `Ledger transaction is unbalanced: debit ${debit} does not equal credit ${credit}`,
    )
  }
}
