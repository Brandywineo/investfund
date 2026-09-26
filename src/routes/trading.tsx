import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
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
  const [visibleHistory, setVisibleHistory] = useState(20)
  const completed = data.completedPositions
  const wins = completed.filter(
    (position) => Number(position.realizedNetProfit) > 0,
  ).length
  const losses = completed.filter(
    (position) => Number(position.realizedNetProfit) < 0,
  ).length
  const realized = completed.reduce(
    (total, position) => total + Number(position.realizedNetProfit),
    0,
  )
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Trading desk
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Platform MT5 trading
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
          {data.canViewLive
            ? 'Live platform positions and completed MT5 trade history.'
            : 'Review completed platform trades. Live positions are available to active investors.'}
        </p>
        {!data.canViewLive && (
          <section className="mt-6 flex flex-col gap-5 rounded-[2rem] bg-[#123d2d] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.15em] text-[#d9ff71]">
                Live investor access
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                Follow positions while they trade
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">
                Start investing to view open positions, partial exits, remaining
                volume and live trading activity.
              </p>
            </div>
            <Link
              to="/invest"
              className="shrink-0 rounded-xl bg-[#d9ff71] px-5 py-3 text-center text-sm font-bold text-[#123d2d]"
            >
              Start investing
            </Link>
          </section>
        )}

        {data.canViewLive && (
          <>
            <h2 className="mt-8 text-xl font-semibold">Open positions</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {data.positions.map((position) => (
                <PositionCard
                  key={position.ticket}
                  position={position}
                  history={data.openPositionHistory.find(
                    (item) =>
                      item.positionTicket === position.ticket ||
                      item.positionTicket === position.identifier,
                  )}
                />
              ))}
              {!data.positions.length && (
                <Empty>No open positions currently reported.</Empty>
              )}
            </div>

            {!!data.orders.length && (
              <>
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
                        <Value
                          label="Requested"
                          value={number(order.requestedPrice)}
                        />
                        <Value
                          label="Volume"
                          value={number(order.volumeCurrent, 8)}
                        />
                        <Value
                          label="Stop loss"
                          value={number(order.stopLoss)}
                        />
                        <Value
                          label="Take profit"
                          value={number(order.takeProfit)}
                        />
                      </div>
                      <p className="mt-4 text-xs text-[#829088]">
                        Placed {new Date(order.placedAt).toLocaleString()}
                      </p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.15em] text-[#6e857a]">
              MT5 performance
            </p>
            <h2 className="mt-1 text-xl font-semibold">Completed positions</h2>
          </div>
          <p className="text-xs text-[#6e857a]">
            {completed.length} positions · {wins} wins · {losses} losses
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Completed" value={String(completed.length)} />
          <Metric
            label="Win rate"
            value={`${completed.length ? ((wins / completed.length) * 100).toFixed(2) : '0.00'}%`}
          />
          <Metric
            label="Realized net P/L"
            value={`${realized >= 0 ? '+' : ''}${realized.toFixed(2)}`}
            tone={realized >= 0 ? 'positive' : 'negative'}
          />
        </div>
        <div className="mt-4 overflow-hidden rounded-[2rem] bg-white ring-1 ring-black/5">
          {completed.slice(0, visibleHistory).map((position) => (
            <CompletedPositionCard
              key={position.positionTicket}
              position={position}
            />
          ))}
          {!completed.length && (
            <div className="p-6">
              <Empty>No completed MT5 positions synchronized yet.</Empty>
            </div>
          )}
        </div>
        {visibleHistory < completed.length && (
          <button
            onClick={() => setVisibleHistory((value) => value + 20)}
            className="mt-4 w-full rounded-xl bg-white px-5 py-3 text-sm font-bold ring-1 ring-black/8"
          >
            Load more positions
          </button>
        )}
      </section>
    </main>
  )
}

function PositionCard({
  position,
  history,
}: {
  position: ReturnType<typeof Route.useLoaderData>['positions'][number]
  history?: ReturnType<
    typeof Route.useLoaderData
  >['openPositionHistory'][number]
}) {
  const partial = history?.status === 'PARTIALLY_CLOSED'
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
          {partial ? 'PARTIAL' : 'OPEN'}
        </span>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Value label="Entry" value={number(position.entryPrice)} />
        <Value label="Current" value={number(position.currentPrice)} />
        <Value
          label={partial ? 'Originally' : 'Volume'}
          value={`${number(history?.initialVolume ?? position.volume, 8)} lots`}
        />
        <Value label="Remaining" value={`${number(position.volume, 8)} lots`} />
      </div>
      {partial && history && (
        <div className="mt-5 rounded-2xl bg-[#f3f6f0] p-4 text-sm">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Value
              label="Partially closed"
              value={`${number(history.closedVolume, 8)} lots`}
            />
            <Value
              label="Average exit"
              value={number(history.averageExitPrice)}
            />
            <Value
              label="Realized P/L"
              value={signedMoney(history.realizedNetProfit)}
            />
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-black/6 pt-4 text-sm">
        <span>
          SL {number(position.stopLoss)} · TP {number(position.takeProfit)}
        </span>
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

function CompletedPositionCard({
  position,
}: {
  position: ReturnType<typeof Route.useLoaderData>['completedPositions'][number]
}) {
  const net = Number(position.realizedNetProfit)
  type Exit = (typeof position.exits)[number]
  return (
    <article className="border-b border-black/5 p-5 text-sm last:border-0">
      <div className="grid gap-4 sm:grid-cols-[1.2fr_.8fr_.8fr_.8fr] sm:items-center">
        <div>
          <b className="text-base">{position.symbol}</b>
          <p className="mt-1 text-xs font-bold uppercase tracking-[.12em] text-[#6e857a]">
            {position.side} · {number(position.initialVolume, 8)} lots · CLOSED
          </p>
        </div>
        <Value
          label="Average entry"
          value={number(position.averageEntryPrice)}
        />
        <Value label="Average exit" value={number(position.averageExitPrice)} />
        <div className="sm:text-right">
          <p className="text-xs text-[#6e857a]">Net P/L</p>
          <b className={net >= 0 ? 'text-green-700' : 'text-red-700'}>
            {signedMoney(position.realizedNetProfit)}
          </b>
          <p className="text-xs text-[#829088]">
            {position.closedAt
              ? new Date(position.closedAt).toLocaleString()
              : 'Closing time pending'}
          </p>
        </div>
      </div>
      {position.exits.length > 1 && (
        <details className="mt-4 rounded-xl bg-[#f3f6f0] p-3">
          <summary className="cursor-pointer text-xs font-bold text-[#557065]">
            {position.exits.length} partial exits
          </summary>
          <div className="mt-3 space-y-2">
            {position.exits.map((exit: Exit) => (
              <div
                key={exit.ticket}
                className="flex flex-wrap justify-between gap-2 text-xs text-[#6e857a]"
              >
                <span>
                  {number(exit.volume, 8)} lots at {number(exit.price)}
                </span>
                <span>{signedMoney(exit.netProfit)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  )
}

function signedMoney(value: string) {
  const amount = Number(value)
  return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)}`
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs text-[#6e857a]">{label}</p>
      <b
        className={`mt-1 block text-xl ${tone === 'positive' ? 'text-green-700' : tone === 'negative' ? 'text-red-700' : ''}`}
      >
        {value}
      </b>
    </div>
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
