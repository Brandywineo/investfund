import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getPortfolio } from '#/server/portfolio.functions'
import { PwaInstall } from '#/components/PwaInstall'
import { formatKenyaDateTime } from '#/domain/display-time'

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
  const lifetimeEarnings = (
    Number(portfolio.earnedProfit) + Number(portfolio.referralIncome)
  ).toFixed(2)
  const activeProfit = Math.max(
    0,
    Number(portfolio.activeInvestmentBalance) -
      Number(portfolio.activePrincipal),
  ).toFixed(2)
  const activityLabels: Record<string, string> = {
    DAILY_ACCRUAL: 'Daily profit credited',
    DEPOSIT_CONFIRMED: 'Deposit confirmed',
    INVESTMENT_ACTIVATED: 'Investment started',
    INVESTMENT_FUNDS_ADDED: 'Funds added to investment',
    INVESTMENT_PROFIT_RELEASED: 'Profit released',
    INVESTMENT_EXIT_APPROVED: 'Investment stopped',
    REFERRAL_COMMISSION_POSTED: 'Referral reward credited',
    WITHDRAWAL_RESERVED: 'Withdrawal requested',
    WITHDRAWAL_RESERVATION_RELEASED: 'Withdrawal funds returned',
  }
  const activity = portfolio.recentActivity.map((item) => ({
    ...item,
    title:
      activityLabels[item.eventType] ??
      item.eventType.replaceAll('_', ' ').toLowerCase(),
  }))

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
          <div className="flex items-center gap-2">
            <Link
              to="/notifications"
              className="relative grid size-10 place-items-center rounded-full bg-white text-[#123d2d] shadow-sm ring-1 ring-black/8"
              title="Notifications"
              aria-label={`${portfolio.unreadNotifications} unread notifications`}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M10 21h4" />
              </svg>
              {portfolio.unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#85ae38] px-1 text-[9px] font-black text-white ring-2 ring-[#f4f6f2]">
                  {portfolio.unreadNotifications > 9
                    ? '9+'
                    : portfolio.unreadNotifications}
                </span>
              )}
            </Link>
            <Link
              to="/account"
              className="grid size-10 place-items-center rounded-full bg-white text-sm font-semibold shadow-sm ring-1 ring-black/8"
              title="Account"
            >
              {user.displayName.slice(0, 2).toUpperCase()}
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
        {Date.now() - new Date(user.createdAt).getTime() <
          24 * 60 * 60 * 1000 && (
          <div className="mb-5 flex flex-col gap-4 rounded-2xl bg-white p-5 ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Get the InvestFund app</p>
              <p className="mt-1 text-sm text-[#6e857a]">
                Install it for faster access. You choose whether to enable
                notifications.
              </p>
            </div>
            <PwaInstall compact />
          </div>
        )}
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
              {Number(portfolio.activePrincipal) > 0
                ? 'Manage investment'
                : 'Start investing'}
            </Link>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <article className="overflow-hidden rounded-[2rem] bg-[#123d2d] p-7 text-white shadow-[0_24px_70px_rgba(18,61,45,.18)] md:p-9">
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
            <div className="mt-9 border-t border-white/12 pt-5">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['Available to withdraw', `$${portfolio.available}`],
                  [
                    'Active investment',
                    `$${portfolio.activeInvestmentBalance}`,
                  ],
                  ['Pending withdrawals', `$${portfolio.pendingWithdrawal}`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-white/50">{label}</p>
                    <p className="mt-1 font-semibold">{value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-4 rounded-2xl bg-white/7 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-white/45">
                  Total earned
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  ${lifetimeEarnings}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <p className="text-xs text-white/50">Investment profit</p>
                  <p className="mt-1 font-semibold">
                    ${portfolio.earnedProfit}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-white/50">Referral rewards</p>
                  <p className="mt-1 font-semibold">
                    ${portfolio.referralIncome}
                  </p>
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-[2rem] bg-[#e2e9d9] p-7 md:p-8">
            <p className="text-sm font-semibold text-[#557065]">
              Current investment
            </p>
            <div className="mt-7 flex items-end justify-between">
              <div>
                <p className="text-3xl font-semibold">
                  ${portfolio.activeInvestmentBalance}
                </p>
                <p className="mt-1 text-sm text-[#557065]">Current value</p>
              </div>
              <div className="grid size-16 place-items-center rounded-full bg-white text-center shadow-sm">
                <span>
                  <b className="block text-sm">{rate}%</b>
                  <span className="block text-[9px] font-semibold uppercase tracking-[.08em] text-[#6e857a]">
                    Daily rate
                  </span>
                </span>
              </div>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/55 p-4">
                <p className="text-xs text-[#557065]">Principal</p>
                <p className="mt-1 font-semibold">
                  ${portfolio.activePrincipal}
                </p>
              </div>
              <div className="rounded-2xl bg-white/55 p-4">
                <p className="text-xs text-[#557065]">Current profit</p>
                <p className="mt-1 font-semibold text-green-700">
                  +${activeProfit}
                </p>
              </div>
            </div>
          </article>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <article className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#557065]">Trading desk</p>
                <h2 className="mt-1 text-xl font-semibold">
                  {!portfolio.canViewLivePositions
                    ? 'Platform MT5 trading'
                    : portfolio.openPositionCount
                      ? `${portfolio.openPositionCount} open position${portfolio.openPositionCount === 1 ? '' : 's'}`
                      : 'No open positions'}
                </h2>
              </div>
              <span className="rounded-full bg-[#eef1eb] px-3 py-1.5 text-xs font-bold text-[#557065]">
                {portfolio.canViewLivePositions && portfolio.openPositionCount
                  ? 'LIVE'
                  : 'TRADING'}
              </span>
            </div>
            {!portfolio.canViewLivePositions ? (
              <>
                <p className="mt-8 text-sm leading-6 text-[#557065]">
                  Review completed platform trades. Start investing to follow
                  live positions and partial exits.
                </p>
                <div className="mt-5 flex flex-wrap gap-4 text-sm font-bold">
                  <Link to="/trading">View trade history →</Link>
                  <Link to="/invest" className="text-[#85ae38]">
                    Start investing
                  </Link>
                </div>
              </>
            ) : portfolio.latestPosition ? (
              <>
                <div className="mt-7 rounded-2xl bg-[#f3f6f0] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[.13em] text-[#6e857a]">
                        Latest position
                      </p>
                      <p className="mt-2 text-lg font-semibold">
                        {portfolio.latestPosition.symbol} ·{' '}
                        {portfolio.latestPosition.side}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {Number(portfolio.latestPosition.volume).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 8 },
                      )}{' '}
                      lots
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-[#6e857a]">Entry</p>
                      <b>
                        {Number(
                          portfolio.latestPosition.entryPrice,
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 10,
                        })}
                      </b>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-[#6e857a]">Live P/L</p>
                      <b
                        className={
                          Number(
                            portfolio.latestPosition.floatingProfit ?? 0,
                          ) >= 0
                            ? 'text-green-700'
                            : 'text-red-700'
                        }
                      >
                        {Number(
                          portfolio.latestPosition.floatingProfit ?? 0,
                        ).toFixed(2)}
                      </b>
                    </div>
                  </div>
                </div>
                <Link
                  to="/trading"
                  className="mt-5 inline-block text-sm font-bold"
                >
                  View platform trading →
                </Link>
              </>
            ) : (
              <>
                <p className="mt-8 text-sm leading-6 text-[#557065]">
                  No platform positions are currently open. Completed trades
                  remain available in the trading desk.
                </p>
                <Link
                  to="/trading"
                  className="mt-5 inline-block text-sm font-bold"
                >
                  View trade history →
                </Link>
              </>
            )}
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
              {activity.length ? (
                activity.map((item) => (
                  <div
                    className="flex items-center justify-between gap-4 py-4"
                    key={item.id}
                  >
                    <div>
                      <p className="text-sm font-semibold capitalize">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-[#83958d]">
                        {formatKenyaDateTime(item.effectiveAt)} EAT
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-bold ${item.direction === 'IN' ? 'text-green-700' : 'text-[#10251c]'}`}
                    >
                      {item.direction === 'IN' ? '+' : '−'}
                      {item.amount} USDT
                    </p>
                  </div>
                ))
              ) : (
                <p className="py-6 text-sm text-[#6e857a]">
                  Your latest financial activity will appear here.
                </p>
              )}
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}
