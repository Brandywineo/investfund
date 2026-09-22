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
  getAdminExitRequests,
  reviewInvestmentExit,
} from '#/server/investment.functions'

export const Route = createFileRoute('/admin_/exits')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getAdminExitRequests(),
  component: ExitAdminPage,
})

function ExitAdminPage() {
  const requests = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await reviewInvestmentExit({
        data: {
          requestId,
          action: String(form.get('action')) as 'APPROVE' | 'DEFER' | 'REJECT',
          reason: String(form.get('reason')),
          reviewAfter: String(form.get('reviewAfter')) || undefined,
        },
      })
      setMessage('Exit request reviewed.')
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed')
    } finally {
      setBusy(false)
    }
  }
  const input =
    'rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-2.5 text-sm outline-none'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              Investment exit requests
            </h1>
          </div>
          <nav className="flex gap-4 text-sm font-bold">
            <Link to="/admin/trading">Trading positions</Link>
            <Link to="/admin">Controls</Link>
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
        <section className="mt-8 space-y-4">
          {requests.length ? (
            requests.map((item) => (
              <article
                key={item.id}
                className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
              >
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <b>{item.userName}</b>
                    <p className="text-xs text-[#6e857a]">
                      {item.userEmail} · requested{' '}
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-2 text-sm">
                      Principal {Number(item.principal).toFixed(2)} USDT ·
                      current balance {Number(item.balance).toFixed(2)} USDT
                    </p>
                    {item.userNote && (
                      <p className="mt-2 text-sm text-[#557065]">
                        User note: {item.userNote}
                      </p>
                    )}
                  </div>
                  <span className="h-fit rounded-full bg-[#eef1eb] px-3 py-1 text-xs font-bold">
                    {item.status}
                  </span>
                </div>
                {['REQUESTED', 'DEFERRED'].includes(item.status) && (
                  <form
                    onSubmit={(event) => void submit(event, item.id)}
                    className="mt-5 grid gap-2 border-t border-black/6 pt-4 md:grid-cols-[150px_1fr_190px_auto]"
                  >
                    <select name="action" className={input}>
                      <option value="APPROVE">Approve</option>
                      <option value="DEFER">Defer</option>
                      <option value="REJECT">Reject</option>
                    </select>
                    <input
                      name="reason"
                      placeholder="Decision reason"
                      className={input}
                    />
                    <input
                      name="reviewAfter"
                      type="datetime-local"
                      className={input}
                    />
                    <button
                      disabled={busy}
                      className="rounded-xl bg-[#123d2d] px-5 py-2.5 text-sm font-bold text-white"
                    >
                      Submit
                    </button>
                  </form>
                )}
                {item.decisionReason && (
                  <p className="mt-4 rounded-xl bg-[#f4f6f2] p-3 text-sm">
                    Decision: {item.decisionReason}
                  </p>
                )}
              </article>
            ))
          ) : (
            <p className="rounded-2xl bg-white p-6 text-sm text-[#6e857a]">
              No investment exit requests.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
