import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import {
  getAdminInvestmentSettings,
  setDailyRate,
  updateInvestmentSettings,
  updateWithdrawalFee,
} from '#/server/admin.functions'
import { currentUser } from '#/server/auth.functions'
import { runDailyAccruals } from '#/server/accrual-runner.functions'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
    return { user }
  },
  loader: () => getAdminInvestmentSettings(),
  component: AdminPage,
})

function AdminPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }
  function updateLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        updateInvestmentSettings({
          data: {
            minimum: Number(form.get('minimum')),
            maximum: Number(form.get('maximum')),
          },
        }),
      'Investment limits updated.',
    )
  }
  function updateRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        setDailyRate({
          data: {
            ratePercent: Number(form.get('rate')),
            reason: String(form.get('reason')),
          },
        }),
      'New daily rate is effective now.',
    )
  }
  function runAccrualBatch() {
    return run(async () => {
      const result = await runDailyAccruals({ data: {} })
      if (result.failures.length)
        throw new Error(
          `${result.posted} posted; ${result.failures.length} failed`,
        )
    }, 'Daily accrual batch completed.')
  }
  function updateFee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        updateWithdrawalFee({
          data: { feePercent: Number(form.get('feePercent')) },
        }),
      'Withdrawal fee updated.',
    )
  }

  const inputClass =
    'mt-2 w-full rounded-2xl border border-black/10 bg-[#f8faf7] px-4 py-3.5 outline-none focus:border-[#85ae38] focus:ring-4 focus:ring-[#85ae38]/15'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Investment controls
            </h1>
          </div>
          <nav
            aria-label="Admin navigation"
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold"
          >
            <Link to="/admin/wallets">Platform wallets</Link>
            <Link to="/admin/custody">Custody</Link>
            <Link to="/admin/referrals">Referrals</Link>
            <Link to="/admin/trading">Trading positions</Link>
            <Link to="/admin/exits">Exit requests</Link>
            <Link to="/admin/users">Manage users</Link>
            <Link to="/app">Dashboard →</Link>
          </nav>
        </div>
        <form
          onSubmit={updateFee}
          className="mt-5 flex flex-col justify-between gap-5 rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:flex-row md:items-end"
        >
          <div>
            <p className="text-sm font-semibold text-[#6e857a]">
              Withdrawal policy
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Platform fee</h2>
            <p className="mt-2 text-sm text-[#6e857a]">
              Each request stores the fee rate and amount permanently when
              submitted.
            </p>
          </div>
          <label className="text-sm font-semibold">
            Fee percentage
            <input
              name="feePercent"
              type="number"
              min="0"
              max="25"
              step="0.01"
              defaultValue={data.settings.withdrawalFeePercent}
              className={inputClass}
            />
          </label>
          <button
            disabled={busy}
            className="rounded-2xl bg-[#123d2d] px-6 py-3.5 font-bold text-white"
          >
            Save fee
          </button>
        </form>
        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <form
            onSubmit={updateLimits}
            className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5"
          >
            <p className="text-sm font-semibold text-[#6e857a]">
              Investment boundaries
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Limits</h2>
            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Minimum
                <input
                  name="minimum"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={data.settings.minimumInvestment}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-semibold">
                Maximum
                <input
                  name="maximum"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={data.settings.maximumInvestment}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              disabled={busy}
              className="mt-7 w-full rounded-2xl bg-[#123d2d] px-5 py-3.5 font-bold text-white disabled:opacity-60"
            >
              Save limits
            </button>
          </form>
          <form
            onSubmit={updateRate}
            className="rounded-[2rem] bg-[#123d2d] p-7 text-white"
          >
            <p className="text-sm font-semibold text-white/55">
              Effective-dated compounding
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Daily rate</h2>
            <label className="mt-7 block text-sm font-semibold">
              Rate percentage
              <input
                name="rate"
                type="number"
                min="0.000001"
                max="100"
                step="0.000001"
                defaultValue={data.currentRate}
                className={`${inputClass} text-[#10251c]`}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Reason
              <input
                name="reason"
                placeholder="Scheduled rate review"
                className={`${inputClass} text-[#10251c]`}
              />
            </label>
            <button
              disabled={busy}
              className="mt-7 w-full rounded-2xl bg-[#d9ff71] px-5 py-3.5 font-bold text-[#123d2d] disabled:opacity-60"
            >
              Make rate effective
            </button>
            <p className="mt-4 text-xs leading-5 text-white/50">
              Previous accrual records remain unchanged. The new rate applies
              only from this point forward.
            </p>
          </form>
        </div>
        <section className="mt-5 flex flex-col justify-between gap-5 rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold text-[#6e857a]">
              Daily operations
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Post due accruals</h2>
            <p className="mt-2 max-w-xl text-sm text-[#6e857a]">
              Processes each active investment once for today. Duplicate
              postings are prevented by the ledger idempotency key.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => void runAccrualBatch()}
            className="shrink-0 rounded-2xl bg-[#123d2d] px-6 py-4 font-bold text-white disabled:opacity-60"
          >
            Run daily accruals
          </button>
        </section>
      </div>
    </main>
  )
}
