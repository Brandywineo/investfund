import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'

export const Route = createFileRoute('/community')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
  },
  component: CommunityPage,
})

function CommunityPage() {
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <section className="mx-auto max-w-4xl">
        <Link to="/app" className="text-sm font-bold text-[#557065]">
          ← Dashboard
        </Link>
        <article className="mt-8 rounded-[2rem] bg-[#123d2d] p-7 text-white md:p-10">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#d9ff71]">
            Community
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] md:text-5xl">
            Investor updates will live here
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-white/65">
            Announcements, trading-desk updates, and platform notices will be
            published here after moderation and notification controls are ready.
          </p>
          <div className="mt-8 inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-[#d9ff71]">
            Planned milestone
          </div>
        </article>
      </section>
    </main>
  )
}
