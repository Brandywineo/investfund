import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  checkpointChainScanner,
  getOperationsDashboard,
} from '#/server/operations.functions'

export const Route = createFileRoute('/admin_/operations')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getOperationsDashboard(),
  component: OperationsPage,
})

function relativeAge(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return 'Never'
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function OperationsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const lagState =
    data.lag <= 10 ? 'Healthy' : data.lag <= 100 ? 'Delayed' : 'Critical'
  const cards = [
    {
      label: 'BSC scanner',
      value: lagState,
      detail: `${data.lag.toLocaleString()} blocks behind`,
      healthy: data.lag <= 100 && data.chainAgeMs <= 120_000,
    },
    {
      label: 'Last chain success',
      value: relativeAge(data.chainAgeMs),
      detail: data.chain?.lastScannedBlock.toLocaleString() ?? 'No cursor',
      healthy: data.chainAgeMs <= 120_000,
    },
    {
      label: 'BNB history scanner',
      value: data.chain?.lastNativeError ? 'Retrying' : 'Scanning',
      detail:
        data.chain?.lastNativeScannedBlock == null
          ? 'Awaiting checkpoint'
          : `${Math.max(0, (data.chain.lastHeadBlock ?? 0) - data.chain.lastNativeScannedBlock).toLocaleString()} blocks behind`,
      healthy: !data.chain?.lastNativeError,
    },
    {
      label: 'RPC pool',
      value: `${data.lastRun?.rpcEndpointCount ?? 0} endpoints`,
      detail: `${data.lastRun?.rpcFailovers ?? 0} failovers in latest run`,
      healthy: data.lastRun?.status === 'SUCCESS',
    },
    {
      label: 'MT5 reporting',
      value: data.mt5?.status ?? 'UNCONFIGURED',
      detail: relativeAge(data.mt5AgeMs),
      healthy: data.mt5?.status === 'ONLINE' && data.mt5AgeMs <= 120_000,
    },
    {
      label: 'Signer configuration',
      value: data.signerConfigured ? 'Configured' : 'Missing',
      detail: 'Loopback signer credentials',
      healthy: data.signerConfigured,
    },
  ]

  async function checkpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await checkpointChainScanner({
        data: {
          confirmation: String(form.get('confirmation')) as 'RESET SCANNER',
          reason: String(form.get('reason')),
          safetyOffset: Number(form.get('safetyOffset')),
        },
      })
      setMessage(
        `Scanner checkpoint advanced from ${result.previous.toLocaleString()} to ${result.target.toLocaleString()}.`,
      )
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkpoint failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Platform operations
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#6e857a]">
              Application-level health, scanner progress and operational alerts.
            </p>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/admin/custody">Custody</Link>
            <Link to="/app">Dashboard →</Link>
          </nav>
        </header>

        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <article
              key={card.label}
              className="rounded-2xl bg-white p-5 ring-1 ring-black/5"
            >
              <div
                className={`h-2 w-2 rounded-full ${card.healthy ? 'bg-[#85ae38]' : 'bg-red-500'}`}
              />
              <p className="mt-4 text-xs font-bold uppercase tracking-wide text-[#6e857a]">
                {card.label}
              </p>
              <p className="mt-2 text-xl font-semibold">{card.value}</p>
              <p className="mt-1 text-xs text-[#6e857a]">{card.detail}</p>
            </article>
          ))}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
            <h2 className="text-xl font-semibold">Recent worker runs</h2>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="text-xs uppercase text-[#6e857a]">
                  <tr>
                    <th className="pb-3">Finished</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Range</th>
                    <th className="pb-3">Lag</th>
                    <th className="pb-3">Runtime</th>
                    <th className="pb-3">Failovers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id} className="border-t border-black/5">
                      <td className="py-3">
                        {new Date(run.finishedAt).toLocaleString()}
                      </td>
                      <td className="py-3 font-semibold">{run.status}</td>
                      <td className="py-3">
                        {run.fromBlock?.toLocaleString() ?? '—'}–
                        {run.toBlock?.toLocaleString() ?? '—'}
                      </td>
                      <td className="py-3">
                        {run.lagBlocks?.toLocaleString() ?? '—'}
                      </td>
                      <td className="py-3">
                        {run.runtimeMs
                          ? `${(run.runtimeMs / 1_000).toFixed(1)}s`
                          : '—'}
                      </td>
                      <td className="py-3">{run.rpcFailovers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
            <h2 className="text-xl font-semibold">Operational alerts</h2>
            <div className="mt-5 space-y-3">
              {data.events.length === 0 && (
                <p className="text-sm text-[#6e857a]">
                  No operational alerts recorded.
                </p>
              )}
              {data.events.map((event) => (
                <article
                  key={event.id}
                  className="rounded-2xl bg-[#f6f8f4] p-4"
                >
                  <div className="flex items-center justify-between gap-3 text-xs font-bold">
                    <span>
                      {event.severity} · {event.component}
                    </span>
                    <span>{event.status}</span>
                  </div>
                  <p className="mt-2 font-semibold">{event.title}</p>
                  <p className="mt-1 text-sm text-[#6e857a]">{event.message}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <form
          onSubmit={checkpoint}
          className="mt-6 rounded-[2rem] border border-red-200 bg-white p-6"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">
            Emergency operation
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Reset scanner near recorded head
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-[#6e857a]">
            This skips the unscanned range and permanently records the
            administrator, old cursor, new cursor and reason. Use only after
            confirming the skipped blocks contain no deposits requiring
            automatic credit.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-[130px_1fr_180px]">
            <label className="text-sm font-semibold">
              Safety blocks
              <input
                name="safetyOffset"
                type="number"
                min="2"
                max="100"
                defaultValue="10"
                className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2.5"
              />
            </label>
            <label className="text-sm font-semibold">
              Reason
              <input
                name="reason"
                required
                minLength={10}
                className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2.5"
                placeholder="Confirmed test environment contains no pending deposits"
              />
            </label>
            <label className="text-sm font-semibold">
              Type RESET SCANNER
              <input
                name="confirmation"
                required
                className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2.5"
              />
            </label>
          </div>
          <button
            disabled={busy}
            className="mt-5 rounded-xl bg-red-700 px-5 py-3 font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Updating…' : 'Create audited checkpoint'}
          </button>
        </form>
      </div>
    </main>
  )
}
