import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { currentUser } from '#/server/auth.functions'
import { getSupportInbox } from '#/server/support-chat.functions'
import { SupportConversation } from '#/components/SupportConversation'

export const Route = createFileRoute('/admin_/support')({
  validateSearch: z.object({ userId: z.string().uuid().optional() }),
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getSupportInbox(),
  component: SupportInbox,
})
function SupportInbox() {
  const initial = Route.useLoaderData()
  const { userId } = Route.useSearch()
  const [inbox, setInbox] = useState(initial)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => {
      void getSupportInbox()
        .then((value) => {
          if (active) setInbox(value)
        })
        .catch(() => {
          if (active) setError('Unable to refresh inbox')
        })
    }
    refresh()
    const timer = setInterval(refresh, 15_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <nav className="flex gap-5 text-sm font-bold">
          <Link to="/admin">← Controls</Link>
          <Link to="/admin/users">Message a user →</Link>
        </nav>
        <h1 className="mt-5 text-4xl font-semibold">Support inbox</h1>
        <p className="mt-2 text-sm text-[#557065]">
          Private conversations with users. Select a thread to reply, or start
          one from Manage users.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 grid items-start gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-3xl bg-white p-4">
            <input
              aria-label="Search conversations"
              placeholder="Search name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="mb-4 w-full rounded-xl border border-black/10 p-3 text-sm"
            />
            {inbox
              .filter((item) =>
                `${item.name} ${item.email}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item) => (
                <Link
                  key={item.userId}
                  to="/admin/support"
                  search={{ userId: item.userId }}
                  className={`mb-2 block rounded-xl p-3 text-sm ${userId === item.userId ? 'bg-[#123d2d] text-white' : 'bg-[#f4f6f2]'}`}
                >
                  <b className="block">
                    {item.name}
                    {item.unread > 0 && ` · ${item.unread} unread`}
                  </b>
                  <span className="break-all text-xs opacity-70">
                    {item.email}
                  </span>
                </Link>
              ))}
            {inbox.length === 0 && (
              <p className="text-sm text-[#557065]">No conversations yet.</p>
            )}
          </aside>
          {userId ? (
            <SupportConversation key={userId} userId={userId} admin />
          ) : (
            <div className="rounded-3xl bg-white p-8 text-sm text-[#557065]">
              Choose a conversation or use Message user to start one.
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
