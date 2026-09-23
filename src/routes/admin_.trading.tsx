import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  getAdminTradingDesk,
  synchronizeMt5Now,
} from '#/server/trading.functions'

export const Route = createFileRoute('/admin_/trading')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getAdminTradingDesk(),
  component: AdminTradingPage,
})

function AdminTradingPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function synchronize() {
    setBusy(true)
    setMessage('')
    try {
      const result = await synchronizeMt5Now()
      setMessage(
        `Synchronized ${result.positions} positions, ${result.orders} orders and ${result.dealsReceived} history deals.`,
      )
      await router.invalidate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'MT5 sync failed')
    } finally {
      setBusy(false)
    }
  }
  const sync = data.sync
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold">MT5 reporting</h1>
          </div>
          <nav className="flex gap-4 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/app">Dashboard →</Link>
          </nav>
        </header>

        <section className="mt-8 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.15em] text-[#6e857a]">
                Read-only bridge
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                {sync?.status ?? 'UNCONFIGURED'}
              </h2>
              <p className="mt-2 text-sm text-[#6e857a]">
                {sync?.serverName ?? 'No broker server connected'}
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => void synchronize()}
              className="rounded-xl bg-[#123d2d] px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Synchronizing…' : 'Synchronize now'}
            </button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Metric label="Open positions" value={data.positions.length} />
            <Metric label="Pending orders" value={data.orders.length} />
            <Metric label="History deals" value={data.deals.length} />
          </div>
          <p className="mt-4 text-xs text-[#6e857a]">
            Last synchronized:{' '}
            {sync?.lastSuccessfulSyncAt
              ? new Date(sync.lastSuccessfulSyncAt).toLocaleString()
              : 'Never'}
          </p>
          {sync?.lastError && (
            <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {sync.lastError}
            </p>
          )}
          {message && (
            <p className="mt-3 rounded-xl bg-[#efffd1] p-3 text-sm">
              {message}
            </p>
          )}
        </section>

        <section className="mt-6 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-xl font-semibold">Live feed inventory</h2>
          <p className="mt-2 text-sm text-[#6e857a]">
            This connection imports trades only. Balance, equity, margin and
            account valuation are never requested or stored.
          </p>
          <div className="mt-5 space-y-3 text-sm">
            {data.positions.map((position) => (
              <article
                key={position.ticket}
                className="rounded-2xl bg-[#f3f6f0] p-4"
              >
                <b>
                  {position.symbol} · {position.side}
                </b>
                <p className="mt-1 text-[#6e857a]">
                  #{position.ticket} · {position.volume} lots · entry{' '}
                  {position.entryPrice}
                </p>
              </article>
            ))}
            {!data.positions.length && <p>No open MT5 positions.</p>}
          </div>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[#f3f6f0] p-4">
      <p className="text-xs text-[#6e857a]">{label}</p>
      <b className="text-2xl">{value}</b>
    </div>
  )
}
