import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { activateInvestment, getPortfolio } from '#/server/portfolio.functions'
import {
  cancelInvestmentExit,
  getInvestmentManagement,
  releaseInvestmentProfit,
  requestInvestmentExit,
} from '#/server/investment.functions'

export const Route = createFileRoute('/invest')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: async () => ({
    portfolio: await getPortfolio(),
    management: await getInvestmentManagement(),
  }),
  component: InvestPage,
})

function InvestPage() {
  const { portfolio, management } = Route.useLoaderData()
  const minimum = Number(portfolio.minimumInvestment).toFixed(2)
  const maximum = Number(portfolio.maximumInvestment).toFixed(2)
  const router = useRouter()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    const amount = String(new FormData(event.currentTarget).get('amount'))
    try {
      await activateInvestment({
        data: { amount, requestId: crypto.randomUUID() },
      })
      setSuccess('Investment activated successfully.')
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Investment failed')
    } finally {
      setBusy(false)
    }
  }
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await action()
      setSuccess(message)
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="min-h-screen bg-[#f4f6f2] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-5xl">
        <Link to="/app" className="text-sm font-bold">
          ← Dashboard
        </Link>
        <div className="mt-10 rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-10">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
            New investment
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-.04em]">
            Put your balance to work
          </h1>
          <p className="mt-3 text-[#6e857a]">
            Available:{' '}
            <b className="text-[#123d2d]">{portfolio.available} USDT</b>
          </p>
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">
                Investment amount
              </span>
              <div className="flex rounded-2xl border border-black/10 bg-[#f8faf7] px-4 focus-within:border-[#85ae38] focus-within:ring-4 focus-within:ring-[#85ae38]/15">
                <input
                  name="amount"
                  inputMode="decimal"
                  placeholder={minimum}
                  className="min-w-0 flex-1 bg-transparent py-4 text-2xl font-semibold outline-none"
                  required
                />
                <span className="self-center text-sm font-bold text-[#6e857a]">
                  USDT
                </span>
              </div>
            </label>
            <div className="flex justify-between text-xs text-[#6e857a]">
              <span>Minimum {minimum}</span>
              <span>Maximum {maximum}</span>
            </div>
            {error && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-xl bg-green-50 p-3 text-sm text-green-700">
                {success}
              </p>
            )}
            <button
              disabled={busy}
              className="w-full rounded-2xl bg-[#123d2d] px-5 py-4 font-bold text-white disabled:opacity-60"
            >
              {busy ? 'Activating…' : 'Activate investment'}
            </button>
          </form>
          <p className="mt-5 text-xs leading-5 text-[#6e857a]">
            The amount is transferred from your available ledger balance into
            your active investment. This operation cannot create or spend funds
            that are not available.
          </p>
        </div>
        <section className="mt-5 space-y-4">
          <h2 className="text-xl font-semibold">Your investments</h2>
          {management.investments.length ? (
            management.investments.map((investment) => (
              <article
                key={investment.id}
                className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
                      {investment.status}
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {investment.balanceDisplay} USDT
                    </p>
                    <p className="mt-1 text-sm text-[#6e857a]">
                      Locked principal {investment.principalDisplay} ·
                      releasable profit {investment.releasableProfit} USDT
                    </p>
                  </div>
                  <Link to="/trading" className="text-sm font-bold">
                    View trading desk →
                  </Link>
                </div>
                {investment.status === 'ACTIVE' && (
                  <div className="mt-5 flex flex-col gap-3 border-t border-black/6 pt-5 sm:flex-row">
                    <button
                      disabled={
                        busy || Number(investment.releasableProfit) <= 0
                      }
                      onClick={() =>
                        void run(
                          () =>
                            releaseInvestmentProfit({
                              data: { investmentId: investment.id },
                            }),
                          'Profit released to your available balance.',
                        )
                      }
                      className="rounded-xl bg-[#d9ff71] px-5 py-3 text-sm font-bold disabled:opacity-40"
                    >
                      Release profit
                    </button>
                    {investment.exitRequest ? (
                      <div className="flex flex-1 flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                        <span>
                          Exit {investment.exitRequest.status.toLowerCase()}
                          {investment.exitRequest.decisionReason
                            ? `: ${investment.exitRequest.decisionReason}`
                            : ''}
                        </span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                cancelInvestmentExit({
                                  data: {
                                    requestId: investment.exitRequest!.id,
                                  },
                                }),
                              'Exit request cancelled.',
                            )
                          }
                          className="font-bold"
                        >
                          Cancel request
                        </button>
                      </div>
                    ) : (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          const note = String(
                            new FormData(event.currentTarget).get('note'),
                          )
                          void run(
                            () =>
                              requestInvestmentExit({
                                data: { investmentId: investment.id, note },
                              }),
                            'Investment exit requested.',
                          )
                        }}
                        className="flex flex-1 flex-col gap-2 sm:flex-row"
                      >
                        <input
                          name="note"
                          placeholder="Optional exit note"
                          className="min-w-0 flex-1 rounded-xl border border-black/10 px-4 py-3 text-sm"
                        />
                        <button
                          disabled={busy}
                          className="rounded-xl border border-black/10 px-5 py-3 text-sm font-bold"
                        >
                          Stop investing
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="rounded-2xl bg-white p-6 text-sm text-[#6e857a]">
              No investments yet.
            </p>
          )}
        </section>
        {management.exitHistory.length > 0 && (
          <section className="mt-5 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
            <h2 className="text-xl font-semibold">Exit request history</h2>
            <div className="mt-4 divide-y divide-black/6">
              {management.exitHistory.slice(0, 10).map((request) => (
                <div key={request.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap justify-between gap-3">
                    <b>{request.status}</b>
                    <span className="text-xs text-[#6e857a]">
                      {new Date(request.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {request.decisionReason && (
                    <p className="mt-2 text-sm text-[#557065]">
                      {request.decisionReason}
                    </p>
                  )}
                  {request.reviewAfter && request.status === 'DEFERRED' && (
                    <p className="mt-1 text-xs text-[#6e857a]">
                      Review expected after{' '}
                      {new Date(request.reviewAfter).toLocaleString()}
                    </p>
                  )}
                  {request.releasedAmount && (
                    <p className="mt-1 text-sm font-semibold text-green-700">
                      {Number(request.releasedAmount).toFixed(2)} USDT released
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
