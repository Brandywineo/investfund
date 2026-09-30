import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  getAdminEmailSettings,
  retryAdminEmail,
  sendAdminTestEmail,
  updateAdminEmailSettings,
} from '#/server/email-admin.functions'

export const Route = createFileRoute('/admin_/email')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
    return { user }
  },
  loader: () => getAdminEmailSettings(),
  component: AdminEmailPage,
})

function AdminEmailPage() {
  const data = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const settings = data.settings

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await router.invalidate()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Email operation failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        updateAdminEmailSettings({
          data: {
            enabled: form.get('enabled') === 'on',
            verificationRequired: form.get('verificationRequired') === 'on',
            apiKey: String(form.get('apiKey') || '') || undefined,
            fromName: String(form.get('fromName')),
            fromAddress: String(form.get('fromAddress')),
            replyToAddress: String(form.get('replyToAddress') || ''),
            verificationExpiryMinutes: Number(
              form.get('verificationExpiryMinutes'),
            ),
            resetExpiryMinutes: Number(form.get('resetExpiryMinutes')),
          },
        }),
      'Email settings saved.',
    )
  }

  function test(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        sendAdminTestEmail({
          data: { recipient: String(form.get('recipient')) },
        }),
      'Test email delivered to Resend.',
    )
  }

  const inputClass =
    'mt-2 w-full rounded-2xl border border-black/10 bg-[#f8faf7] px-4 py-3.5 outline-none focus:border-[#85ae38] focus:ring-4 focus:ring-[#85ae38]/15'
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-.04em]">
              Transactional email
            </h1>
            <p className="mt-2 text-sm text-[#6e857a]">
              Resend delivery, account verification and password recovery.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/admin/operations">Operations</Link>
            <Link to="/app">Dashboard →</Link>
          </nav>
        </div>

        {!data.encryptionConfigured ? (
          <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
            EMAIL_SETTINGS_ENCRYPTION_KEY is not configured. Keep delivery
            disabled until the server key is added.
          </p>
        ) : null}
        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}

        <section className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Pending" value={data.counts.PENDING ?? 0} />
          <Metric label="Sent" value={data.counts.SENT ?? 0} />
          <Metric label="Failed" value={data.counts.FAILED ?? 0} />
          <Metric label="Provider" value="Resend" />
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_.6fr]">
          <form
            onSubmit={save}
            className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#6e857a]">
                  Provider configuration
                </p>
                <h2 className="mt-1 text-2xl font-semibold">Resend</h2>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${settings?.enabled ? 'bg-green-100 text-green-700' : 'bg-black/5 text-[#6e857a]'}`}
              >
                {settings?.enabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Sender name
                <input
                  name="fromName"
                  required
                  defaultValue={settings?.fromName ?? 'InvestFund'}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-semibold">
                Sender address
                <input
                  name="fromAddress"
                  type="email"
                  required
                  defaultValue={
                    settings?.fromAddress ?? 'no-reply@investfund.site'
                  }
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-semibold">
                Reply-to address
                <input
                  name="replyToAddress"
                  type="email"
                  defaultValue={
                    settings?.replyToAddress ?? 'support@investfund.site'
                  }
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-semibold">
                Resend API key
                <input
                  name="apiKey"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    settings?.hasApiKey
                      ? `Saved ••••${settings.apiKeyLastFour ?? ''}`
                      : 're_...'
                  }
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-semibold">
                Verification expiry (minutes)
                <input
                  name="verificationExpiryMinutes"
                  type="number"
                  min="15"
                  max="10080"
                  defaultValue={settings?.verificationExpiryMinutes ?? 1440}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-semibold">
                Reset expiry (minutes)
                <input
                  name="resetExpiryMinutes"
                  type="number"
                  min="10"
                  max="1440"
                  defaultValue={settings?.resetExpiryMinutes ?? 30}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="mt-6 space-y-3 rounded-2xl bg-[#f8faf7] p-4 text-sm">
              <label className="flex items-center gap-3 font-semibold">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={settings?.enabled}
                  className="size-5 accent-[#123d2d]"
                />
                Enable email delivery
              </label>
              <label className="flex items-center gap-3 font-semibold">
                <input
                  name="verificationRequired"
                  type="checkbox"
                  defaultChecked={settings?.verificationRequired}
                  className="size-5 accent-[#123d2d]"
                />
                Require verification for new registrations
              </label>
            </div>
            <button
              disabled={busy || !data.encryptionConfigured}
              className="mt-6 w-full rounded-2xl bg-[#123d2d] px-5 py-3.5 font-bold text-white disabled:opacity-50"
            >
              Save email configuration
            </button>
          </form>

          <div className="space-y-5">
            <form
              onSubmit={test}
              className="rounded-[2rem] bg-[#123d2d] p-7 text-white"
            >
              <p className="text-sm font-semibold text-white/55">
                Delivery test
              </p>
              <h2 className="mt-1 text-2xl font-semibold">Send a real email</h2>
              <label className="mt-5 block text-sm font-semibold">
                Recipient
                <input
                  name="recipient"
                  type="email"
                  required
                  defaultValue={user.email}
                  className={`${inputClass} text-[#10251c]`}
                />
              </label>
              <button
                disabled={busy || !settings?.enabled}
                className="mt-5 w-full rounded-2xl bg-[#d9ff71] px-5 py-3.5 font-bold text-[#123d2d] disabled:opacity-50"
              >
                Send test
              </button>
            </form>
            <div className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5">
              <p className="text-sm font-semibold text-[#6e857a]">
                Last successful delivery
              </p>
              <p className="mt-2 font-semibold">
                {settings?.lastSuccessfulDeliveryAt
                  ? new Date(settings.lastSuccessfulDeliveryAt).toLocaleString()
                  : 'None yet'}
              </p>
              {settings?.lastFailureReason ? (
                <p className="mt-4 text-sm text-red-700">
                  {settings.lastFailureReason}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <section className="mt-5 rounded-[2rem] bg-white p-7 ring-1 ring-black/5">
          <h2 className="text-2xl font-semibold">Recent delivery events</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[#6e857a]">
                <tr>
                  <th className="pb-3">Recipient</th>
                  <th className="pb-3">Category</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Attempts</th>
                  <th className="pb-3">Created</th>
                  <th className="pb-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((delivery) => (
                  <tr
                    key={delivery.id}
                    className="border-t border-black/5 align-top"
                  >
                    <td className="py-4 pr-4">
                      <b>{delivery.recipient}</b>
                      <span className="mt-1 block text-xs text-[#6e857a]">
                        {delivery.subject}
                      </span>
                      {delivery.failureReason ? (
                        <span className="mt-1 block max-w-sm text-xs text-red-700">
                          {delivery.failureReason}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-4 pr-4">{delivery.category}</td>
                    <td className="py-4 pr-4">{delivery.status}</td>
                    <td className="py-4 pr-4">{delivery.attempts}</td>
                    <td className="py-4 pr-4">
                      {new Date(delivery.createdAt).toLocaleString()}
                    </td>
                    <td className="py-4">
                      {delivery.status === 'FAILED' ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                retryAdminEmail({ data: { id: delivery.id } }),
                              'Email retry processed.',
                            )
                          }
                          className="font-bold text-[#123d2d]"
                        >
                          Retry
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {!data.deliveries.length ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#6e857a]">
                      No emails have been queued.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-black/5">
      <p className="text-xs font-bold uppercase tracking-wide text-[#6e857a]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
