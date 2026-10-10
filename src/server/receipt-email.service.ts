import { eq } from 'drizzle-orm'
import type { Database } from '#/db'
import { emailOutbox, emailSettings, users } from '#/db/schema'
import { appOrigin } from './email.service'
import { receiptEmail } from './email-template'

type TransactionExecutor = Parameters<Parameters<Database['transaction']>[0]>[0]

// Persist with the business event. No network calls on the scanner/payment path.
export async function queueUserReceipt(
  tx: TransactionExecutor,
  input: {
    userId: string
    eventKey: string
    category: string
    title: string
    message: string
    details?: Array<[string, string]>
    path?: string
  },
) {
  const settings = await tx
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!settings?.enabled) return
  const user = await tx
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!user) throw new Error('Receipt recipient not found')
  await tx
    .insert(emailOutbox)
    .values({
      recipient: user.email,
      eventKey: input.eventKey,
      category: input.category,
      ...receiptEmail({
        displayName: user.displayName,
        title: input.title,
        message: input.message,
        details: input.details ?? [],
        url: `${appOrigin()}${input.path ?? '/ledger'}`,
      }),
    })
    .onConflictDoNothing({ target: emailOutbox.eventKey })
}

export function receiptTime(date: Date): string {
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false,
    }).format(date) + ' EAT (Kenya)'
  )
}

export async function queueDepositReceipt(
  tx: TransactionExecutor,
  deposit: {
    id: string
    userId: string
    amount: string
    network: string
    txHash: string | null
    confirmedAt: Date | null
  },
) {
  await queueUserReceipt(tx, {
    userId: deposit.userId,
    eventKey: `deposit:${deposit.id}:confirmed`,
    category: 'DEPOSIT_CONFIRMED',
    title: 'Deposit confirmed',
    message:
      'your deposit was credited to your available balance. A deposit does not automatically start an investment. If you intend to invest, open Invest and complete activation, then check the start time in Ledger.',
    details: [
      ['Amount credited', `${deposit.amount} USDT`],
      ['Network', deposit.network],
      ['Confirmed at', receiptTime(deposit.confirmedAt ?? new Date())],
      ['Deposit reference', deposit.id],
      ['Transaction reference', deposit.txHash ?? 'See Ledger'],
    ],
  })
}

export async function queueWithdrawalReceipt(
  tx: TransactionExecutor,
  withdrawal: {
    id: string
    userId: string
    amount: string
    feeAmount: string
    netAmount: string
    network: string
    destinationAddress: string
    txHash?: string | null
  },
  status:
    | 'REQUESTED'
    | 'BROADCAST'
    | 'CONFIRMED'
    | 'FAILED'
    | 'REJECTED'
    | 'CANCELLED',
  reason?: string,
) {
  const messages = {
    REQUESTED: [
      'Withdrawal requested',
      'your withdrawal request is pending review. The requested amount has been reserved; no payment has been sent yet.',
    ],
    BROADCAST: [
      'Withdrawal broadcast',
      'your withdrawal transaction was broadcast to the blockchain and is awaiting confirmation. This is not yet a confirmed payment.',
    ],
    CONFIRMED: [
      'Withdrawal confirmed',
      'your withdrawal transaction was confirmed on the blockchain.',
    ],
    FAILED: [
      'Withdrawal failed',
      'your withdrawal did not complete. The reserved amount has been restored to your available balance.',
    ],
    REJECTED: [
      'Withdrawal rejected',
      'your withdrawal request was rejected. The reserved amount has been restored to your available balance.',
    ],
    CANCELLED: [
      'Withdrawal cancelled',
      'your withdrawal was cancelled. The requested amount has been restored to your available balance.',
    ],
  } as const
  const [title, message] = messages[status]
  await queueUserReceipt(tx, {
    userId: withdrawal.userId,
    eventKey: `withdrawal:${withdrawal.id}:${status.toLowerCase()}`,
    category: `WITHDRAWAL_${status}`,
    title,
    message,
    details: [
      ['Status', status],
      ['Requested amount', `${withdrawal.amount} USDT`],
      ['Fee', `${withdrawal.feeAmount} USDT`],
      ['Net payout', `${withdrawal.netAmount} USDT`],
      ['Network', withdrawal.network],
      ['Destination', withdrawal.destinationAddress],
      ['Withdrawal reference', withdrawal.id],
      ['Updated at', receiptTime(new Date())],
      ...(withdrawal.txHash
        ? [['Transaction reference', withdrawal.txHash] as [string, string]]
        : []),
      ...(reason ? [['Reason', reason] as [string, string]] : []),
    ],
    path: '/wallet',
  })
}
