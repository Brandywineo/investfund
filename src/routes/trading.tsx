import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'

export const Route = createFileRoute('/trading')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
  },
  component: TradingPage,
})

function TradingPage() {
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <section className="mx-auto max-w-4xl">
        <Link to="/app" className="text-sm font-bold text-[#557065]">
          ← Dashboard
        </Link>
        <article className="mt-8 rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-10">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
            Trading desk
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] md:text-5xl">
            Transparent trading is coming next
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-[#557065]">
            This area will show the strategy account, open and closed positions,
            and verified performance. Investment and ledger balances remain
            separate from trading reporting until that connection is enabled.
          </p>
          <div className="mt-8 inline-flex rounded-full bg-[#eef1eb] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[#557065]">
            Planned milestone
          </div>
        </article>
      </section>
    </main>
  )
}
