import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthField, AuthForm, AuthPage } from '#/components/AuthPage'
import { currentUser, requestPasswordReset } from '#/server/auth.functions'

export const Route = createFileRoute('/forgot-password')({
  beforeLoad: async () => {
    if (await currentUser()) throw redirect({ to: '/app' })
  },
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await requestPasswordReset({ data: { email: String(form.get('email')) } })
      setSent(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthPage
      eyebrow="Account recovery"
      title="Reset your password"
      description="Enter your email address and we will send a single-use recovery link if the account exists."
      alternateText="Remembered your password?"
      alternateLabel="Sign in"
      alternateTo="/login"
    >
      {sent ? (
        <p className="rounded-2xl bg-green-50 p-5 text-sm leading-6 text-green-800">
          If an account exists for that address, a password-reset email has been
          queued. Check your inbox and spam folder.
        </p>
      ) : (
        <AuthForm
          onSubmit={submit}
          error={error}
          busy={busy}
          buttonLabel="Send reset link"
        >
          <AuthField
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
          />
        </AuthForm>
      )}
    </AuthPage>
  )
}
