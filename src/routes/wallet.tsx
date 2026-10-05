import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import {
  cancelWithdrawal,
  getCustodyAccount,
  requestWithdrawal,
} from '#/server/custody.functions'
import { currentUser } from '#/server/auth.functions'
import { FullAddress, PasteButton } from '#/components/AddressActions'

export const Route = createFileRoute('/wallet')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: () => getCustodyAccount(),
  component: WalletPage,
})

const withdrawalLabels: Record<string, string> = {
  REQUESTED: 'Under review',
  APPROVED: 'Approved',
  PROCESSING: 'Preparing transfer',
  BROADCAST: 'Sent',
  CONFIRMED: 'Confirmed',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

const depositLabels: Record<string, string> = {
  PENDING: 'Confirming',
  CONFIRMED: 'Credited',
  IGNORED_DUST: 'Below deposit minimum',
  REJECTED: 'Not credited',
}

function activityDate(value: Date | string | null | undefined) {
  if (!value) return null
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(value))
}

function statusTone(status: string) {
  if (status === 'CONFIRMED') return 'bg-green-100 text-green-800'
  if (['FAILED', 'REJECTED', 'CANCELLED'].includes(status))
    return 'bg-red-100 text-red-800'
  return 'bg-amber-100 text-amber-800'
}

function WithdrawalProgress({ status }: { status: string }) {
  if (['FAILED', 'REJECTED', 'CANCELLED'].includes(status)) return null
  const current =
    status === 'CONFIRMED'
      ? 3
      : status === 'BROADCAST' || status === 'PROCESSING'
        ? 2
        : status === 'APPROVED'
          ? 1
          : 0
  return (
    <div
      className="mt-4 grid grid-cols-4 gap-1"
      aria-label="Withdrawal progress"
    >
      {['Requested', 'Approved', 'Sending', 'Confirmed'].map((label, index) => (
        <div key={label} className="min-w-0">
          <div
            className={`h-1.5 rounded-full ${index <= current ? 'bg-[#85ae38]' : 'bg-black/10'}`}
          />
          <p
            className={`mt-1 truncate text-[9px] font-bold uppercase tracking-[.04em] ${index <= current ? 'text-[#36520f]' : 'text-[#91a098]'}`}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  )
}

function WalletPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [destinationAddress, setDestinationAddress] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const availableBalance = Number(data.balances.available)
  const requestedAmount = Number(withdrawalAmount)
  const amountExceedsAvailable =
    Number.isFinite(requestedAmount) && requestedAmount > availableBalance
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }
  function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        requestWithdrawal({
          data: {
            amount: String(form.get('amount')),
            destinationAddress: String(form.get('address')),
          },
        }),
      'Withdrawal request submitted.',
    )
  }
  const input =
    'mt-2 w-full rounded-2xl border border-black/10 bg-[#f8faf7] px-4 py-3 outline-none focus:border-[#85ae38]'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Custody account
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Deposit and withdraw
            </h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </header>
        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <article className="rounded-[2rem] bg-[#123d2d] p-7 text-white">
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#d9ff71]">
              {data.settings.network} USDT
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Your deposit address
            </h2>
            {data.depositAddress ? (
              <FullAddress value={data.depositAddress} dark />
            ) : (
              <p className="mt-5 rounded-2xl bg-white/10 p-4 text-sm">
                Deposit address not configured
              </p>
            )}
            <p className="mt-4 text-xs text-white/55">
              {data.automatedDeposits
                ? 'Send only BEP20 USDT. Deposits are detected and credited automatically after one confirmation.'
                : 'Automatic deposit addresses will appear after the HD wallet signer is connected.'}
            </p>
          </article>
          <form
            onSubmit={withdraw}
            className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5"
          >
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
              {data.settings.network} USDT
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Request withdrawal</h2>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                ['Available', data.balances.available],
                ['Invested', data.balances.invested],
                ['Pending', data.balances.pendingWithdrawal],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-[#f4f6f2] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#6e857a]">
                    {label}
                  </p>
                  <p className="mt-1 text-base font-bold">{value}</p>
                  <p className="text-[10px] text-[#6e857a]">USDT</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-[#6e857a]">
              Only your available balance can be withdrawn. Active investment
              capital remains locked until it is released.
            </p>
            <label className="mt-7 block text-sm font-semibold">
              <span className="flex items-center justify-between gap-3">
                Amount
                <button
                  type="button"
                  onClick={() => setWithdrawalAmount(data.balances.available)}
                  className="text-xs font-bold text-[#527c16]"
                >
                  Use max
                </button>
              </span>
              <input
                name="amount"
                value={withdrawalAmount}
                onChange={(event) => setWithdrawalAmount(event.target.value)}
                inputMode="decimal"
                min={Number(data.settings.minimumWithdrawalAmount)}
                max={availableBalance}
                step="0.00000001"
                required
                className={input}
              />
            </label>
            {amountExceedsAvailable && (
              <p className="mt-2 text-xs font-semibold text-red-700">
                Amount exceeds your available balance of{' '}
                {data.balances.available} USDT.
              </p>
            )}
            <label className="relative mt-4 block text-sm font-semibold">
              Destination address
              <input
                name="address"
                value={destinationAddress}
                onChange={(event) => setDestinationAddress(event.target.value)}
                required
                className={`${input} pr-24 font-mono text-sm`}
              />
              <PasteButton onPaste={setDestinationAddress} />
            </label>
            <button
              disabled={busy || amountExceedsAvailable}
              className="mt-6 w-full rounded-2xl bg-[#123d2d] px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              Request withdrawal
            </button>
            {Number(withdrawalAmount) > 0 && (
              <div className="mt-4 rounded-xl bg-[#f4f6f2] p-4 text-sm">
                <div className="flex justify-between">
                  <span>Requested</span>
                  <b>{Number(withdrawalAmount).toFixed(2)} USDT</b>
                </div>
                <div className="mt-2 flex justify-between">
                  <span>
                    Platform fee (
                    {Number(data.settings.withdrawalFeePercent).toFixed(2)}%)
                  </span>
                  <b>
                    −
                    {(
                      (Number(withdrawalAmount) *
                        Number(data.settings.withdrawalFeePercent)) /
                      100
                    ).toFixed(2)}{' '}
                    USDT
                  </b>
                </div>
                <div className="mt-2 flex justify-between border-t border-black/8 pt-2">
                  <span>You receive</span>
                  <b>
                    {(
                      Number(withdrawalAmount) *
                      (1 - Number(data.settings.withdrawalFeePercent) / 100)
                    ).toFixed(2)}{' '}
                    USDT
                  </b>
                </div>
              </div>
            )}
            <p className="mt-4 text-xs text-[#6e857a]">
              Minimum {Number(data.settings.minimumWithdrawalAmount).toFixed(2)}{' '}
              USDT. Funds are locked immediately, then sent automatically after
              administrator approval.
            </p>
          </form>
        </div>
        <section className="mt-5 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-xl font-semibold">Custody activity</h2>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-[#6e857a]">Deposits</h3>
              <div className="mt-3 space-y-3">
                {data.deposits.length ? (
                  data.deposits.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl bg-[#f4f6f2] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <b>{Number(item.amount).toFixed(2)} USDT</b>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em] ${statusTone(item.status)}`}
                        >
                          {depositLabels[item.status] ?? item.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-[#6e857a]">
                        {item.network} ·{' '}
                        {activityDate(item.confirmedAt ?? item.submittedAt)}
                      </p>
                      {item.txHash && (
                        <div className="mt-3 rounded-xl bg-white/70 p-3">
                          <p className="break-all font-mono text-[10px] leading-relaxed text-[#6e857a]">
                            {item.txHash}
                          </p>
                          <a
                            href={`https://bscscan.com/tx/${item.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs font-bold text-[#527c16]"
                          >
                            View on BscScan ↗
                          </a>
                        </div>
                      )}
                      {item.rejectionReason && (
                        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">
                          {item.rejectionReason}
                        </p>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 p-5 text-sm text-[#6e857a]">
                    Confirmed deposits will appear here with their transaction
                    details.
                  </div>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#6e857a]">Withdrawals</h3>
              <div className="mt-3 space-y-3">
                {data.withdrawals.length ? (
                  data.withdrawals.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl bg-[#f4f6f2] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <b>{Number(item.amount).toFixed(2)} USDT</b>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em] ${statusTone(item.status)}`}
                        >
                          {withdrawalLabels[item.status] ?? item.status}
                        </span>
                      </div>
                      <WithdrawalProgress status={item.status} />
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-white/70 p-3">
                          <span className="text-[#6e857a]">Platform fee</span>
                          <b className="mt-1 block">
                            {Number(item.feeAmount).toFixed(2)} USDT
                          </b>
                        </div>
                        <div className="rounded-xl bg-white/70 p-3">
                          <span className="text-[#6e857a]">You receive</span>
                          <b className="mt-1 block">
                            {Number(item.netAmount).toFixed(2)} USDT
                          </b>
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl bg-white/70 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-[.06em] text-[#6e857a]">
                          Destination · {item.network}
                        </p>
                        <p className="mt-1 break-all font-mono text-[10px] leading-relaxed">
                          {item.destinationAddress}
                        </p>
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-[#6e857a]">
                        <p>Requested: {activityDate(item.createdAt)}</p>
                        {item.reviewedAt && (
                          <p>Reviewed: {activityDate(item.reviewedAt)}</p>
                        )}
                        {item.broadcastAt && (
                          <p>Sent: {activityDate(item.broadcastAt)}</p>
                        )}
                        {item.confirmedAt && (
                          <p>Confirmed: {activityDate(item.confirmedAt)}</p>
                        )}
                      </div>
                      {item.txHash && (
                        <div className="mt-3 rounded-xl bg-white/70 p-3">
                          <p className="break-all font-mono text-[10px] leading-relaxed text-[#6e857a]">
                            {item.txHash}
                          </p>
                          <a
                            href={`https://bscscan.com/tx/${item.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs font-bold text-[#527c16]"
                          >
                            View on BscScan ↗
                          </a>
                        </div>
                      )}
                      {['FAILED', 'REJECTED', 'CANCELLED'].includes(
                        item.status,
                      ) && (
                        <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">
                          <b className="block">Administrator response</b>
                          {item.rejectionReason && (
                            <p className="mt-1">{item.rejectionReason}</p>
                          )}
                          <p className="mt-2 font-semibold">
                            The reserved amount has been returned to your
                            available balance.
                          </p>
                        </div>
                      )}
                      {item.status === 'REQUESTED' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                cancelWithdrawal({
                                  data: { withdrawalId: item.id },
                                }),
                              'Withdrawal cancelled.',
                            )
                          }
                          className="mt-3 text-xs font-bold text-red-700"
                        >
                          Cancel request
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 p-5 text-sm text-[#6e857a]">
                    You have no withdrawal requests yet. A submitted request
                    will show its review and on-chain progress here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
