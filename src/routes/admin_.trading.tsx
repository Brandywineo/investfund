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
  createTradingPosition,
  getAdminTradingDesk,
  updateTradingPosition,
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
  const positions = Route.useLoaderData()
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
      setError(cause instanceof Error ? cause.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        createTradingPosition({
          data: {
            symbol: String(form.get('symbol')),
            side: String(form.get('side')) as 'BUY' | 'SELL',
            entryPrice: String(form.get('entryPrice')),
            currentPrice: String(form.get('currentPrice')),
            stopLoss: String(form.get('stopLoss')),
            takeProfit: String(form.get('takeProfit')),
            sizeLabel: String(form.get('sizeLabel')),
            note: String(form.get('note')),
            openedAt: String(form.get('openedAt')),
          },
        }),
      'Position published.',
    )
  }
  function update(event: FormEvent<HTMLFormElement>, positionId: string) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        updateTradingPosition({
          data: {
            positionId,
            action: String(form.get('action')) as 'UPDATE' | 'CLOSE' | 'CANCEL',
            currentPrice: String(form.get('currentPrice')),
            pnlPercent: String(form.get('pnlPercent')),
            note: String(form.get('note')),
          },
        }),
      'Position updated.',
    )
  }
  const input =
    'rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-2.5 outline-none'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Trading positions</h1>
          </div>
          <nav className="flex gap-4 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/admin/exits">Exit requests</Link>
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
        <form
          onSubmit={create}
          className="mt-8 rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
        >
          <h2 className="text-xl font-semibold">Publish open position</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              name="symbol"
              required
              placeholder="EURUSD"
              className={input}
            />
            <select name="side" className={input}>
              <option>BUY</option>
              <option>SELL</option>
            </select>
            <input
              name="entryPrice"
              required
              inputMode="decimal"
              placeholder="Entry price"
              className={input}
            />
            <input
              name="currentPrice"
              inputMode="decimal"
              placeholder="Current price"
              className={input}
            />
            <input
              name="stopLoss"
              inputMode="decimal"
              placeholder="Stop loss"
              className={input}
            />
            <input
              name="takeProfit"
              inputMode="decimal"
              placeholder="Take profit"
              className={input}
            />
            <input
              name="sizeLabel"
              placeholder="Allocation / size label"
              className={input}
            />
            <input name="openedAt" type="datetime-local" className={input} />
            <input
              name="note"
              placeholder="Strategy note"
              className={`${input} sm:col-span-2 lg:col-span-4`}
            />
          </div>
          <button
            disabled={busy}
            className="mt-4 rounded-xl bg-[#123d2d] px-6 py-3 font-bold text-white"
          >
            Publish position
          </button>
        </form>
        <section className="mt-5 space-y-3">
          {positions.map((item) => (
            <form
              key={item.id}
              onSubmit={(event) => void update(event, item.id)}
              className="rounded-2xl bg-white p-5 ring-1 ring-black/5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b>
                    {item.symbol} · {item.side}
                  </b>
                  <p className="text-xs text-[#6e857a]">
                    Entry {item.entryPrice} · {item.status}
                  </p>
                </div>
                {item.status === 'OPEN' && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      name="currentPrice"
                      placeholder="Current price"
                      defaultValue={item.currentPrice || ''}
                      className={input}
                    />
                    <input
                      name="pnlPercent"
                      placeholder="P/L %"
                      defaultValue={item.pnlPercent || ''}
                      className={input}
                    />
                    <input
                      name="note"
                      placeholder="Update note"
                      defaultValue={item.note || ''}
                      className={input}
                    />
                    <select name="action" className={input}>
                      <option value="UPDATE">Update</option>
                      <option value="CLOSE">Close</option>
                      <option value="CANCEL">Cancel</option>
                    </select>
                    <button
                      disabled={busy}
                      className="rounded-xl bg-[#d9ff71] px-4 py-2 text-sm font-bold"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            </form>
          ))}
        </section>
      </div>
    </main>
  )
}
