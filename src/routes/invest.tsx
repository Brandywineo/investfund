import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { activateInvestment, getPortfolio } from '#/server/portfolio.functions'

export const Route = createFileRoute('/invest')({
  beforeLoad: async () => { if (!(await currentUser())) throw redirect({ to: '/login' }) },
  loader: () => getPortfolio(),
  component: InvestPage,
})

function InvestPage() {
  const portfolio = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    const amount = String(new FormData(event.currentTarget).get('amount'))
    try {
      await activateInvestment({ data: { amount, requestId: crypto.randomUUID() } })
      setSuccess('Investment activated successfully.')
      await router.invalidate()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Investment failed') }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-[#f4f6f2] px-5 py-8 text-[#10251c] md:px-10"><div className="mx-auto max-w-3xl"><Link to="/app" className="text-sm font-bold">← Dashboard</Link><div className="mt-10 rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-10"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">New investment</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.04em]">Put your balance to work</h1><p className="mt-3 text-[#6e857a]">Available: <b className="text-[#123d2d]">{portfolio.available} USDT</b></p><form className="mt-8 space-y-5" onSubmit={submit}><label className="block"><span className="mb-2 block text-sm font-semibold">Investment amount</span><div className="flex rounded-2xl border border-black/10 bg-[#f8faf7] px-4 focus-within:border-[#85ae38] focus-within:ring-4 focus-within:ring-[#85ae38]/15"><input name="amount" inputMode="decimal" placeholder={portfolio.minimumInvestment} className="min-w-0 flex-1 bg-transparent py-4 text-2xl font-semibold outline-none" required /><span className="self-center text-sm font-bold text-[#6e857a]">USDT</span></div></label><div className="flex justify-between text-xs text-[#6e857a]"><span>Minimum {portfolio.minimumInvestment}</span><span>Maximum {portfolio.maximumInvestment}</span></div>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{success && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-700">{success}</p>}<button disabled={busy} className="w-full rounded-2xl bg-[#123d2d] px-5 py-4 font-bold text-white disabled:opacity-60">{busy ? 'Activating…' : 'Activate investment'}</button></form><p className="mt-5 text-xs leading-5 text-[#6e857a]">The amount is transferred from your available ledger balance into your active investment. This operation cannot create or spend funds that are not available.</p></div></div></main>
}
