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

function WalletPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [destinationAddress, setDestinationAddress] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
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
            <label className="mt-7 block text-sm font-semibold">
              Amount
              <input
                name="amount"
                value={withdrawalAmount}
                onChange={(event) => setWithdrawalAmount(event.target.value)}
                inputMode="decimal"
                min={Number(data.settings.minimumWithdrawalAmount)}
                step="0.00000001"
                required
                className={input}
              />
            </label>
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
              disabled={busy}
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
                      <div className="flex justify-between gap-4">
                        <b>{Number(item.amount).toFixed(2)} USDT</b>
                        <span className="text-xs font-bold">{item.status}</span>
                      </div>
                      <p className="mt-2 truncate text-xs text-[#6e857a]">
                        {item.txHash}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[#6e857a]">
                    No deposits submitted.
                  </p>
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
                      <div className="flex justify-between gap-4">
                        <b>{Number(item.amount).toFixed(2)} USDT</b>
                        <span className="text-xs font-bold">{item.status}</span>
                      </div>
                      <p className="mt-2 break-all font-mono text-xs text-[#6e857a]">
                        {item.destinationAddress}
                      </p>
                      <p className="mt-2 text-xs text-[#6e857a]">
                        Fee {Number(item.feeAmount).toFixed(2)} · sends{' '}
                        {Number(item.netAmount).toFixed(2)} USDT
                      </p>
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
                  <p className="text-sm text-[#6e857a]">
                    No withdrawals requested.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
