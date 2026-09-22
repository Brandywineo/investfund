import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getPortfolio } from '#/server/portfolio.functions'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: () => getPortfolio(),
  component: Home,
})

function Home() {
  const { user } = Route.useRouteContext()
  const portfolio = Route.useLoaderData()
  const now = new Date()
  const todayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      hour12: false,
    }).format(now),
  )
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const rate = Number(portfolio.dailyRatePercent).toFixed(2)
  const activity = portfolio.latestActivatedAt
    ? [
        [
          'Investment activated',
          `${portfolio.activePrincipal} USDT`,
          new Date(portfolio.latestActivatedAt).toISOString().slice(0, 10),
        ],
      ]
    : [['No transactions yet', '—', 'Fund your wallet to begin']]

  return (
    <main className="min-h-screen bg-[#f4f6f2] text-[#10251c]">
      <nav className="border-b border-black/8 bg-[#f4f6f2]/90 px-5 py-4 backdrop-blur md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#123d2d] text-lg font-black text-[#d9ff71]">
              I
            </div>
            <span className="text-lg font-semibold tracking-tight">
              InvestFund
            </span>
          </div>
          <div className="hidden items-center gap-8 text-sm text-[#557065] md:flex">
            <span className="font-semibold text-[#123d2d]">Overview</span>
            <Link to="/invest">Invest</Link>
            <Link to="/wallet">Wallet</Link>
            <Link to="/referrals">Referrals</Link>
            <Link to="/trading">Trading</Link>
            <Link to="/community">Community</Link>
            <Link to="/ledger">Ledger</Link>
            <Link to="/account">Account</Link>
            {user.role === 'ADMIN' ? <Link to="/admin">Admin</Link> : null}
          </div>
          <Link
            to="/account"
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-black/8"
            title="Account"
          >
            {user.displayName.slice(0, 2).toUpperCase()}
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#648174]">
              {todayLabel}
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              {greeting}, {user.displayName.split(' ')[0]}.
            </h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/wallet"
              className="w-fit rounded-full bg-white px-6 py-3 text-sm font-bold text-[#123d2d] ring-1 ring-black/8"
            >
              Wallet
            </Link>
            <Link
              to="/referrals"
              className="w-fit rounded-full bg-white px-6 py-3 text-sm font-bold text-[#123d2d] ring-1 ring-black/8"
            >
              Referrals
            </Link>
            <Link
              to="/invest"
              className="w-fit rounded-full bg-[#d9ff71] px-6 py-3 text-sm font-bold text-[#123d2d] shadow-[0_8px_30px_rgba(133,176,31,.2)]"
            >
              Start investing
            </Link>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <article className="overflow-hidden rounded-[2rem] bg-[#123d2d] p-7 text-white shadow-[0_24px_70px_rgba(18,61,45,.18)] md:p-10">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-white/60">Total portfolio</p>
                <p className="mt-3 text-4xl font-semibold tracking-[-0.04em] md:text-6xl">
                  ${portfolio.totalPortfolio}
                </p>
              </div>
              <span className="rounded-full bg-[#d9ff71]/15 px-3 py-1.5 text-xs font-bold text-[#d9ff71]">
                {rate}% daily rate
              </span>
            </div>
            <div className="mt-12 grid grid-cols-2 gap-4 border-t border-white/12 pt-6 md:grid-cols-4">
              {[
                ['Active investment', `$${portfolio.activeInvestmentBalance}`],
                ['Available', `$${portfolio.available}`],
                ['Principal', `$${portfolio.activePrincipal}`],
                ['Daily rate', `${rate}%`],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-white/50">{label}</p>
                  <p className="mt-1 font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[2rem] bg-[#e2e9d9] p-7 md:p-8">
            <p className="text-sm font-semibold text-[#557065]">
              Current investment
            </p>
            <div className="mt-8 flex items-end justify-between">
              <div>
                <p className="text-3xl font-semibold">
                  ${portfolio.activeInvestmentBalance}
                </p>
                <p className="mt-1 text-sm text-[#557065]">
                  Compounding balance
                </p>
              </div>
              <div className="grid size-16 place-items-center rounded-full bg-white text-sm font-bold shadow-sm">
                {rate}%
              </div>
            </div>
            <div className="mt-8 h-2 overflow-hidden rounded-full bg-black/8">
              <div className="h-full w-2/3 rounded-full bg-[#85ae38]" />
            </div>
            <p className="mt-4 text-xs leading-5 text-[#557065]">
              Rate changes apply forward only. Every daily posting remains
              visible in your ledger.
            </p>
          </article>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <article className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#557065]">Trading desk</p>
                <h2 className="mt-1 text-xl font-semibold">
                  {portfolio.openPositionCount
                    ? `${portfolio.openPositionCount} open position${portfolio.openPositionCount === 1 ? '' : 's'}`
                    : 'No open positions'}
                </h2>
              </div>
              <span className="rounded-full bg-[#eef1eb] px-3 py-1.5 text-xs font-bold text-[#557065]">
                {portfolio.openPositionCount ? 'LIVE' : 'READY'}
              </span>
            </div>
            <p className="mt-8 text-sm leading-6 text-[#557065]">
              {portfolio.openPositionCount
                ? `${portfolio.latestPositionSymbol} is the latest position reported by the trading desk.`
                : 'The trading desk is ready. New positions appear here after an administrator publishes them.'}
            </p>
            <Link to="/trading" className="mt-5 inline-block text-sm font-bold">
              View trading desk →
            </Link>
          </article>

          <article className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Recent activity</h2>
              <Link
                to="/ledger"
                className="text-sm font-semibold text-[#557065]"
              >
                View ledger
              </Link>
            </div>
            <div className="mt-5 divide-y divide-black/6">
              {activity.map(([title, amount, time]) => (
                <div
                  className="flex items-center justify-between py-4"
                  key={title}
                >
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-xs text-[#83958d]">{time}</p>
                  </div>
                  <p className="text-sm font-bold">{amount}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}
