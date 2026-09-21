import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AuthField, AuthForm, AuthPage } from '#/components/AuthPage'
import { currentUser, register } from '#/server/auth.functions'

export const Route = createFileRoute('/signup')({
  beforeLoad: async () => { if (await currentUser()) throw redirect({ to: '/app' }) },
  component: SignupPage,
})

function SignupPage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const form = new FormData(event.currentTarget)
    try { await register({ data: { displayName: String(form.get('displayName')), email: String(form.get('email')), password: String(form.get('password')) } }); await navigate({ to: '/app' }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Registration failed') }
    finally { setBusy(false) }
  }
  return <AuthPage eyebrow="Create account" title="Start with a clear ledger" description="Your deposits, investments and daily accruals will each have a permanent transaction record." alternateText="Already registered?" alternateLabel="Sign in" alternateTo="/login"><AuthForm onSubmit={submit} error={error} busy={busy} buttonLabel="Create secure account"><AuthField label="Full name" name="displayName" autoComplete="name" /><AuthField label="Email address" name="email" type="email" autoComplete="email" /><AuthField label="Password (10+ characters)" name="password" type="password" autoComplete="new-password" /></AuthForm></AuthPage>
}
