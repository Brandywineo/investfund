import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthPage } from '#/components/AuthPage'
import { verifyEmail } from '#/server/auth.functions'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await verifyEmail({ data: { token } })
      await navigate({ to: '/app' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Verification failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthPage
      eyebrow="Email verification"
      title="Activate your account"
      description="Confirm this email address to unlock your InvestFund account."
      alternateText="Return to"
      alternateLabel="Sign in"
      alternateTo="/login"
    >
      <div className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
        {error ? (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || !token}
          onClick={() => void confirm()}
          className="w-full rounded-2xl bg-[#123d2d] px-5 py-3.5 font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Verify email address'}
        </button>
        {!token ? (
          <Link
            to="/login"
            className="mt-4 block text-center text-sm font-bold"
          >
            This link is incomplete
          </Link>
        ) : null}
      </div>
    </AuthPage>
  )
}
