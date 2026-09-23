import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { currentUser } from '#/server/auth.functions'
import { getTradingDesk } from '#/server/trading.functions'

export const Route = createFileRoute('/trading')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: () => getTradingDesk(),
  component: TradingPage,
})

function number(value: string | null, digits = 10) {
  return value === null
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function TradingPage() {
  const data = Route.useLoaderData()
  const online = data.sync?.status === 'ONLINE'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Trading desk
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Live platform trades
            </h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[#557065]">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${online ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}
          >
            {online ? 'LIVE' : 'FEED DELAYED'}
          </span>
          <span>
            {data.sync?.lastSuccessfulSyncAt
              ? `Updated ${new Date(data.sync.lastSuccessfulSyncAt).toLocaleString()}`
              : 'Waiting for the first MT5 synchronization'}
          </span>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-[#557065]">
          Positions, pending orders and trade history are synchronized from the
          platform MT5 account. Account balance and equity are not collected.
          Investment returns continue to follow the published daily rate.
        </p>
        {!data.hasInvestment && (
          <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
            Activate an investment to participate in the platform strategy.
            Trading activity remains visible for transparency.
          </p>
        )}

        <h2 className="mt-8 text-xl font-semibold">Open positions</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.positions.map((position) => (
            <PositionCard key={position.ticket} position={position} />
          ))}
          {!data.positions.length && (
            <Empty>No open positions currently reported.</Empty>
          )}
        </div>

        <h2 className="mt-8 text-xl font-semibold">Pending orders</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.orders.map((order) => (
            <article
              key={order.ticket}
              className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
            >
              <div className="flex justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
                    {order.orderType}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">
                    {order.symbol}
                  </h3>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                  PENDING
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <Value label="Requested" value={number(order.requestedPrice)} />
                <Value label="Volume" value={number(order.volumeCurrent, 8)} />
                <Value label="Stop loss" value={number(order.stopLoss)} />
                <Value label="Take profit" value={number(order.takeProfit)} />
              </div>
              <p className="mt-4 text-xs text-[#829088]">
                Placed {new Date(order.placedAt).toLocaleString()}
              </p>
            </article>
          ))}
          {!data.orders.length && (
            <Empty>No pending orders currently reported.</Empty>
          )}
        </div>

        <h2 className="mt-8 text-xl font-semibold">Complete trade history</h2>
        <div className="mt-4 overflow-hidden rounded-[2rem] bg-white ring-1 ring-black/5">
          {data.deals.map((deal) => (
            <article
              key={deal.ticket}
              className="grid gap-2 border-b border-black/5 p-5 text-sm last:border-0 sm:grid-cols-[1.2fr_.8fr_.8fr_.8fr] sm:items-center"
            >
              <div>
                <b>
                  {deal.symbol} · {deal.side}
                </b>
                <p className="text-xs text-[#6e857a]">
                  {deal.entry} · #{deal.ticket}
                </p>
              </div>
              <Value label="Price" value={number(deal.price)} />
              <Value label="Volume" value={number(deal.volume, 8)} />
              <div className="sm:text-right">
                <p className="text-xs text-[#6e857a]">Result</p>
                <b
                  className={
                    Number(deal.profit) >= 0 ? 'text-green-700' : 'text-red-700'
                  }
                >
                  {Number(deal.profit).toFixed(2)}
                </b>
                <p className="text-xs text-[#829088]">
                  {new Date(deal.executedAt).toLocaleString()}
                </p>
              </div>
            </article>
          ))}
          {!data.deals.length && (
            <div className="p-6">
              <Empty>No MT5 trade history synchronized yet.</Empty>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function PositionCard({
  position,
}: {
  position: ReturnType<typeof Route.useLoaderData>['positions'][number]
}) {
  return (
    <article className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
            {position.side} position
          </p>
          <h3 className="mt-2 text-2xl font-semibold">{position.symbol}</h3>
        </div>
        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
          OPEN
        </span>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Value label="Entry" value={number(position.entryPrice)} />
        <Value label="Current" value={number(position.currentPrice)} />
        <Value label="Stop loss" value={number(position.stopLoss)} />
        <Value label="Take profit" value={number(position.takeProfit)} />
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-black/6 pt-4 text-sm">
        <span>{number(position.volume, 8)} lots</span>
        <b
          className={
            Number(position.floatingProfit ?? 0) >= 0
              ? 'text-green-700'
              : 'text-red-700'
          }
        >
          {position.floatingProfit === null
            ? 'P/L pending'
            : `${Number(position.floatingProfit).toFixed(2)} P/L`}
        </b>
      </div>
      <p className="mt-3 text-xs text-[#829088]">
        Opened {new Date(position.openedAt).toLocaleString()}
      </p>
    </article>
  )
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[#6e857a]">{label}</p>
      <b>{value}</b>
    </div>
  )
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl bg-white p-6 text-sm text-[#6e857a]">
      {children}
    </p>
  )
}
