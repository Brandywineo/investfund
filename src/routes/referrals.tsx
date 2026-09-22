import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getReferralDashboard } from '#/server/referral.functions'

export const Route = createFileRoute('/referrals')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: () => getReferralDashboard(),
  component: ReferralsPage,
})

function ReferralsPage() {
  const data = Route.useLoaderData()
  const link = `/signup?ref=${data.code}`
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Referral network
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Grow together</h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </header>
        <section className="mt-8 rounded-[2rem] bg-[#123d2d] p-7 text-white">
          <p className="text-sm text-white/60">Your referral link</p>
          <p className="mt-3 break-all rounded-xl bg-white/10 p-4 font-mono text-sm">
            {link}
          </p>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(
                `${window.location.origin}${link}`,
              )
            }
            className="mt-4 rounded-xl bg-[#d9ff71] px-5 py-3 font-bold text-[#123d2d]"
          >
            Copy referral link
          </button>
          <p className="mt-4 text-xs text-white/55">
            Level 1: {Number(data.rates[0]).toFixed(2)}% · Level 2:{' '}
            {Number(data.rates[1]).toFixed(2)}% · Level 3:{' '}
            {Number(data.rates[2]).toFixed(2)}% of posted daily profit. The
            platform pays every commission.
          </p>
        </section>
        <section className="mt-5 grid gap-3 sm:grid-cols-4">
          {Object.entries(data.summary).map(([key, value]) => (
            <article
              key={key}
              className="rounded-2xl bg-white p-5 ring-1 ring-black/5"
            >
              <p className="text-xs uppercase text-[#6e857a]">{key}</p>
              <b className="mt-2 block text-xl">
                {Number(value).toFixed(2)} USDT
              </b>
            </article>
          ))}
        </section>
        <section className="mt-5 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-xl font-semibold">Direct referrals</h2>
          <div className="mt-4 space-y-3">
            {data.directReferrals.length ? (
              data.directReferrals.map((item) => (
                <div
                  key={`${item.displayName}-${item.joinedAt}`}
                  className="rounded-xl bg-[#f4f6f2] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b>{item.displayName}</b>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase text-[#557065]">
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#6e857a]">
                    Joined {new Date(item.joinedAt).toISOString().slice(0, 10)}{' '}
                    · earned you {Number(item.earnings).toFixed(2)} USDT
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[#6e857a]">No direct referrals yet.</p>
            )}
          </div>
        </section>
        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          {data.networkStats.map((level) => (
            <article
              key={level.level}
              className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
            >
              <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
                Level {level.level} network
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <b className="text-xl">{level.members}</b>
                  <p className="text-xs text-[#6e857a]">Members</p>
                </div>
                <div>
                  <b className="text-xl">{level.investing}</b>
                  <p className="text-xs text-[#6e857a]">Investing</p>
                </div>
                <div>
                  <b className="text-xl">{Number(level.earnings).toFixed(2)}</b>
                  <p className="text-xs text-[#6e857a]">USDT earned</p>
                </div>
              </div>
            </article>
          ))}
        </section>
        <section className="mt-5 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-xl font-semibold">Commission history</h2>
          <div className="mt-4 space-y-3">
            {data.commissions.length ? (
              data.commissions.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between gap-4 rounded-xl bg-[#f4f6f2] p-4"
                >
                  <div>
                    <b>
                      Level {item.level} · {item.sourceName}
                    </b>
                    <p className="text-xs text-[#6e857a]">
                      {Number(item.ratePercent).toFixed(2)}% of{' '}
                      {Number(item.sourceProfit).toFixed(2)} USDT profit
                    </p>
                  </div>
                  <b className="text-green-700">
                    +{Number(item.amount).toFixed(2)} USDT
                  </b>
                </div>
              ))
            ) : (
              <p className="text-sm text-[#6e857a]">
                No commissions posted yet.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
