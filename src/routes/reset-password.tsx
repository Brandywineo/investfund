import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthField, AuthForm, AuthPage } from '#/components/AuthPage'
import { resetPassword } from '#/server/auth.functions'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await resetPassword({
        data: {
          token,
          password: String(form.get('password')),
          confirmPassword: String(form.get('confirmPassword')),
        },
      })
      setComplete(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password reset failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthPage
      eyebrow="Account recovery"
      title="Choose a new password"
      description="Your recovery link can be used once. Completing this form signs out all existing sessions."
      alternateText="Return to"
      alternateLabel="Sign in"
      alternateTo="/login"
    >
      {!token ? (
        <p className="rounded-2xl bg-red-50 p-5 text-sm text-red-700">
          This password-reset link is incomplete.
        </p>
      ) : complete ? (
        <div className="rounded-2xl bg-green-50 p-5 text-sm leading-6 text-green-800">
          Your password has been changed.{' '}
          <Link to="/login" className="font-bold underline">
            Sign in with your new password.
          </Link>
        </div>
      ) : (
        <AuthForm
          onSubmit={submit}
          error={error}
          busy={busy}
          buttonLabel="Save new password"
        >
          <AuthField
            label="New password (10+ characters)"
            name="password"
            type="password"
            autoComplete="new-password"
          />
          <AuthField
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
          />
        </AuthForm>
      )}
    </AuthPage>
  )
}
