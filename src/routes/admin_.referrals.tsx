import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getReferralAdmin } from '#/server/referral.functions'

export const Route = createFileRoute('/admin_/referrals')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getReferralAdmin(),
  component: AdminReferralsPage,
})

function AdminReferralsPage() {
  const data = Route.useLoaderData()
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Referral network</h1>
          </div>
          <Link to="/admin" className="text-sm font-bold">
            Controls →
          </Link>
        </header>
        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((level) => {
            const total = data.totals.find((item) => item.level === level)
            return (
              <article key={level} className="rounded-2xl bg-white p-5">
                <p className="text-xs uppercase text-[#6e857a]">
                  Level {level} · {data.rates[level - 1]}%
                </p>
                <b className="mt-2 block text-xl">
                  {Number(total?.amount ?? 0).toFixed(8)} USDT
                </b>
                <p className="text-xs text-[#6e857a]">
                  {total?.count ?? 0} postings
                </p>
              </article>
            )
          })}
        </section>
        <section className="mt-5 overflow-x-auto rounded-[2rem] bg-white">
          <table className="w-full min-w-[800px] text-left">
            <thead>
              <tr className="border-b text-xs uppercase text-[#6e857a]">
                <th className="p-5">Referred user</th>
                <th>Referrer</th>
                <th>Code</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.relationships.map((item, index) => (
                <tr
                  key={`${item.referredEmail}-${index}`}
                  className="border-b last:border-0"
                >
                  <td className="p-5">
                    <b>{item.referredName}</b>
                    <p className="text-xs">{item.referredEmail}</p>
                  </td>
                  <td>
                    <b>{item.referrerName}</b>
                    <p className="text-xs">{item.referrerEmail}</p>
                  </td>
                  <td className="font-mono">{item.code}</td>
                  <td>{new Date(item.createdAt).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.relationships.length && (
            <p className="p-6 text-sm text-[#6e857a]">
              No referral relationships yet.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
