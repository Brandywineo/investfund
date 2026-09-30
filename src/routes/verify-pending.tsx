import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthPage } from '#/components/AuthPage'
import { resendVerificationEmail } from '#/server/auth.functions'

export const Route = createFileRoute('/verify-pending')({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === 'string' ? search.email.slice(0, 254) : '',
  }),
  component: VerifyPendingPage,
})

function VerifyPendingPage() {
  const { email } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function resend() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await resendVerificationEmail({ data: { email } })
      setMessage('A new verification email has been queued.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthPage
      eyebrow="Email verification"
      title="Check your inbox"
      description={`We sent a verification link to ${email || 'your email address'}. Open it to activate your account.`}
      alternateText="Already verified?"
      alternateLabel="Sign in"
      alternateTo="/login"
    >
      <div className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
        <p className="text-sm leading-6 text-[#6e857a]">
          The link expires after 24 hours. Check your spam folder before
          requesting another message.
        </p>
        {message || error ? (
          <p
            className={`mt-4 rounded-xl p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || !email}
          onClick={() => void resend()}
          className="mt-5 w-full rounded-2xl bg-[#123d2d] px-5 py-3.5 font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Please wait…' : 'Resend verification email'}
        </button>
        <Link
          to="/login"
          className="mt-4 block text-center text-sm font-bold text-[#123d2d]"
        >
          Return to sign in
        </Link>
      </div>
    </AuthPage>
  )
}
