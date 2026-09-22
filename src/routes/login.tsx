import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AuthField, AuthForm, AuthPage } from '#/components/AuthPage'
import { currentUser, login } from '#/server/auth.functions'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await currentUser()) throw redirect({ to: '/app' })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await login({
        data: {
          email: String(form.get('email')),
          password: String(form.get('password')),
        },
      })
      await navigate({ to: '/app' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthPage
      eyebrow="Welcome back"
      title="Access your portfolio"
      description="Sign in to view your investment ledger, trading activity and community."
      alternateText="New to InvestFund?"
      alternateLabel="Create an account"
      alternateTo="/signup"
    >
      <AuthForm
        onSubmit={submit}
        error={error}
        busy={busy}
        buttonLabel="Sign in"
      >
        <AuthField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
      </AuthForm>
    </AuthPage>
  )
}
