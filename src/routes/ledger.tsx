import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getLedgerHistory } from '#/server/ledger.functions'

export const Route = createFileRoute('/ledger')({
  beforeLoad: async () => { if (!(await currentUser())) throw redirect({ to: '/login' }) },
  loader: () => getLedgerHistory(),
  component: LedgerPage,
})

function LedgerPage() {
  const transactions = Route.useLoaderData()
  return <main className="min-h-screen bg-[#f4f6f2] px-5 py-8 text-[#10251c] md:px-10"><div className="mx-auto max-w-5xl"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">Account records</p><h1 className="mt-2 text-4xl font-semibold tracking-[-.04em]">Your ledger</h1></div><Link to="/app" className="text-sm font-bold">Dashboard →</Link></div><div className="mt-8 overflow-hidden rounded-[2rem] bg-white ring-1 ring-black/5">{transactions.length === 0 ? <p className="p-10 text-center text-[#6e857a]">No ledger transactions yet.</p> : transactions.map((transaction) => <article key={transaction.id} className="border-b border-black/6 p-6 last:border-0 md:flex md:items-start md:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#85ae38]">{transaction.eventType.replaceAll('_', ' ')}</p><h2 className="mt-2 font-semibold">{transaction.description}</h2><p className="mt-1 text-xs text-[#829088]">{new Date(transaction.effectiveAt).toLocaleString()}</p></div><div className="mt-4 space-y-2 md:mt-0 md:min-w-56">{transaction.lines.map((line, index) => <div key={`${transaction.id}-${index}`} className="flex items-center justify-between gap-8 text-sm"><span className="text-[#6e857a]">{line.account.toLowerCase()}</span><b>{Number(line.credit) > 0 ? `+${Number(line.credit).toFixed(2)}` : `-${Number(line.debit).toFixed(2)}`}</b></div>)}</div></article>)}</div></div></main>
}
