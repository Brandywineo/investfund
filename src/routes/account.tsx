import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { changePassword, currentUser, logout } from '#/server/auth.functions'

export const Route = createFileRoute('/account')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: AccountPage,
})

function AccountPage() {
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await changePassword({
        data: {
          currentPassword: String(form.get('currentPassword')),
          newPassword: String(form.get('newPassword')),
          confirmPassword: String(form.get('confirmPassword')),
        },
      })
      await navigate({ to: '/login' })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Password change failed',
      )
    } finally {
      setBusy(false)
    }
  }
  const input =
    'mt-2 w-full rounded-2xl border border-black/10 bg-[#f8faf7] px-4 py-3.5 outline-none focus:border-[#85ae38] focus:ring-4 focus:ring-[#85ae38]/15'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Account security
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Profile and password
            </h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </header>
        <section className="mt-8 rounded-[2rem] bg-white p-7 ring-1 ring-black/5">
          <div className="grid gap-4 rounded-2xl bg-[#f4f6f2] p-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#6e857a]">
                Name
              </p>
              <p className="mt-1 font-semibold">{user.displayName}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#6e857a]">
                Email
              </p>
              <p className="mt-1 font-semibold">{user.email}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#6e857a]">
                Role
              </p>
              <p className="mt-1 font-semibold">{user.role}</p>
            </div>
          </div>
          <form onSubmit={submit} className="mt-7">
            <h2 className="text-xl font-semibold">Change password</h2>
            <p className="mt-2 text-sm text-[#6e857a]">
              Changing your password signs out every active session, including
              this one.
            </p>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold">
                Current password
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={input}
                />
              </label>
              <label className="block text-sm font-semibold">
                New password
                <input
                  name="newPassword"
                  type="password"
                  minLength={10}
                  autoComplete="new-password"
                  required
                  className={input}
                />
              </label>
              <label className="block text-sm font-semibold">
                Confirm new password
                <input
                  name="confirmPassword"
                  type="password"
                  minLength={10}
                  autoComplete="new-password"
                  required
                  className={input}
                />
              </label>
            </div>
            {error && (
              <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              disabled={busy}
              className="mt-5 w-full rounded-2xl bg-[#123d2d] px-5 py-3.5 font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Updating…' : 'Change password and sign out'}
            </button>
          </form>
          <button
            onClick={async () => {
              await logout()
              await navigate({ to: '/login' })
            }}
            className="mt-5 w-full rounded-2xl border border-black/10 px-5 py-3.5 font-bold"
          >
            Sign out
          </button>
        </section>
      </div>
    </main>
  )
}
