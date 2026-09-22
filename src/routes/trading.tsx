import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getTradingDesk } from '#/server/trading.functions'

export const Route = createFileRoute('/trading')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: () => getTradingDesk(),
  component: TradingPage,
})

function price(value: string | null) {
  return value
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 10 })
    : '—'
}

function PositionCard({
  position,
}: {
  position: ReturnType<typeof Route.useLoaderData>['open'][number]
}) {
  return (
    <article className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
            {position.side} position
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{position.symbol}</h2>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${position.status === 'OPEN' ? 'bg-green-100 text-green-800' : 'bg-[#eef1eb] text-[#557065]'}`}
        >
          {position.status}
        </span>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-[#6e857a]">Entry</p>
          <b>{price(position.entryPrice)}</b>
        </div>
        <div>
          <p className="text-[#6e857a]">Current / close</p>
          <b>{price(position.currentPrice)}</b>
        </div>
        <div>
          <p className="text-[#6e857a]">Stop loss</p>
          <b>{price(position.stopLoss)}</b>
        </div>
        <div>
          <p className="text-[#6e857a]">Take profit</p>
          <b>{price(position.takeProfit)}</b>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-black/6 pt-4 text-sm">
        <span>{position.sizeLabel || 'Platform allocation'}</span>
        <b
          className={
            Number(position.pnlPercent) >= 0 ? 'text-green-700' : 'text-red-700'
          }
        >
          {position.pnlPercent
            ? `${Number(position.pnlPercent).toFixed(2)}%`
            : 'P/L pending'}
        </b>
      </div>
      {position.note && (
        <p className="mt-3 text-sm text-[#557065]">{position.note}</p>
      )}
      <p className="mt-3 text-xs text-[#829088]">
        Opened {new Date(position.openedAt).toLocaleString()}
      </p>
    </article>
  )
}

function TradingPage() {
  const data = Route.useLoaderData()
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Trading desk
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Platform positions
            </h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-[#557065]">
          These positions are reported by the platform for transparency. Your
          investment return is still calculated by the published daily rate and
          is not calculated from individual position results.
        </p>
        {!data.hasInvestment && (
          <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
            Activate an investment to participate in the platform strategy.
            Position reporting remains visible for transparency.
          </p>
        )}
        <h2 className="mt-8 text-xl font-semibold">Open positions</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.open.length ? (
            data.open.map((item) => (
              <PositionCard key={item.id} position={item} />
            ))
          ) : (
            <p className="rounded-2xl bg-white p-6 text-sm text-[#6e857a]">
              No open positions currently reported.
            </p>
          )}
        </div>
        <h2 className="mt-8 text-xl font-semibold">Recently closed</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.closed.length ? (
            data.closed.map((item) => (
              <PositionCard key={item.id} position={item} />
            ))
          ) : (
            <p className="rounded-2xl bg-white p-6 text-sm text-[#6e857a]">
              No closed positions yet.
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
