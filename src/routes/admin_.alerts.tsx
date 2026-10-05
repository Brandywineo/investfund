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
  getAdminAlertSettings,
  retryAdminAlert,
  sendAdminPushTest,
  sendAdminWhatsAppTest,
  updateAdminAlertSettings,
} from '#/server/admin-alert.functions'

export const Route = createFileRoute('/admin_/alerts')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getAdminAlertSettings(),
  component: AdminAlertsPage,
})

function AdminAlertsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const settings = data.settings
  const inputClass =
    'mt-2 w-full rounded-2xl border border-black/10 bg-[#f8faf7] px-4 py-3.5 outline-none focus:border-[#85ae38] focus:ring-4 focus:ring-[#85ae38]/15'

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await action()
      setMessage(success)
      await router.invalidate()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Alert operation failed',
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
        updateAdminAlertSettings({
          data: {
            whatsappEnabled: form.get('whatsappEnabled') === 'on',
            adminPushEnabled: form.get('adminPushEnabled') === 'on',
            whatsappRecipient: String(form.get('whatsappRecipient') || ''),
            notifyUserSweeps: form.get('notifyUserSweeps') === 'on',
            notifyDirectHotDeposits:
              form.get('notifyDirectHotDeposits') === 'on',
            notifyWithdrawalRequests:
              form.get('notifyWithdrawalRequests') === 'on',
            minimumAlertAmount: Number(form.get('minimumAlertAmount')),
            supportEmail: String(form.get('supportEmail')),
            supportEmailEnabled: form.get('supportEmailEnabled') === 'on',
          },
        }),
      'Administrator alert and support settings saved.',
    )
  }

  function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      () =>
        sendAdminWhatsAppTest({
          data: { recipient: String(form.get('testRecipient')) },
        }),
      'WhatsApp test alert delivered.',
    )
  }

  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-.04em]">
              Alerts and support
            </h1>
            <p className="mt-2 text-sm text-[#6e857a]">
              Private custody alerts for administrators and the official user
              support address.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/admin/operations">Operations</Link>
            <Link to="/app">Dashboard →</Link>
          </nav>
        </div>

        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}

        <section className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="WhatsApp provider"
            value={
              data.provider === 'WEB_BRIDGE'
                ? 'Local web bridge'
                : data.provider === 'META'
                  ? 'Meta Cloud API'
                  : 'Not configured'
            }
          />
          <Metric
            label="Connection"
            value={
              data.providerStatus === 'CONNECTED' ||
              data.providerStatus === 'READY'
                ? 'Connected'
                : data.providerStatus === 'QR_REQUIRED'
                  ? 'Scan QR code'
                  : data.providerConfigured
                    ? data.providerStatus
                    : 'Server setup required'
            }
          />
          <Metric label="Sent" value={data.counts.SENT ?? 0} />
          <Metric label="Failed" value={data.counts.FAILED ?? 0} />
        </section>

        {!data.providerConfigured ? (
          <p className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
            Configure either the loopback WhatsApp Web bridge or Meta Cloud API
            before enabling WhatsApp delivery.
          </p>
        ) : null}

        <form
          onSubmit={save}
          className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]"
        >
          <section className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5">
            <p className="text-sm font-semibold text-[#6e857a]">
              Administrator-only channel
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Hot-wallet alerts</h2>
            <label className="mt-6 block text-sm font-semibold">
              Administrator WhatsApp number
              <input
                name="whatsappRecipient"
                type="tel"
                placeholder="+2547XXXXXXXX"
                defaultValue={settings?.whatsappRecipient ?? ''}
                className={inputClass}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Minimum alert amount (USDT)
              <input
                name="minimumAlertAmount"
                type="number"
                min="0.10"
                step="0.01"
                defaultValue={settings?.minimumAlertAmount ?? '0.10'}
                className={inputClass}
              />
            </label>
            <div className="mt-5 space-y-3 rounded-2xl bg-[#f8faf7] p-4 text-sm">
              <Check
                name="adminPushEnabled"
                label="Enable real-time administrator PWA alerts"
                checked={settings?.adminPushEnabled ?? true}
              />
              <Check
                name="whatsappEnabled"
                label="Enable private WhatsApp alerts"
                checked={settings?.whatsappEnabled ?? false}
              />
              <Check
                name="notifyUserSweeps"
                label="Alert when a user deposit reaches a hot wallet"
                checked={settings?.notifyUserSweeps ?? true}
              />
              <Check
                name="notifyDirectHotDeposits"
                label="Alert for direct external deposits into a hot wallet"
                checked={settings?.notifyDirectHotDeposits ?? true}
              />
              <Check
                name="notifyWithdrawalRequests"
                label="Alert when a user requests a withdrawal"
                checked={settings?.notifyWithdrawalRequests ?? true}
              />
            </div>
            <p className="mt-4 text-xs leading-5 text-[#6e857a]">
              BNB, dust, MT5 returns and transfers between controlled wallets do
              not trigger deposit alerts.
            </p>
          </section>

          <section className="rounded-[2rem] bg-[#123d2d] p-7 text-white">
            <p className="text-sm font-semibold text-white/55">User contact</p>
            <h2 className="mt-1 text-2xl font-semibold">Official support</h2>
            <label className="mt-6 block text-sm font-semibold">
              Support email address
              <input
                name="supportEmail"
                type="email"
                required
                defaultValue={data.support.email}
                className={`${inputClass} text-[#10251c]`}
              />
            </label>
            <div className="mt-5 rounded-2xl bg-white/8 p-4 text-sm">
              <Check
                name="supportEmailEnabled"
                label="Show support email on user pages"
                checked={data.support.enabled}
                light
              />
            </div>
            <p className="mt-4 text-xs leading-5 text-white/55">
              Users see a muted clickable email link. The private WhatsApp
              recipient is never exposed as a support method.
            </p>
            <button
              disabled={busy}
              className="mt-6 w-full rounded-2xl bg-[#d9ff71] px-5 py-3.5 font-bold text-[#123d2d] disabled:opacity-50"
            >
              Save alert and support settings
            </button>
          </section>
        </form>

        <form
          onSubmit={sendTest}
          className="mt-5 rounded-[2rem] bg-white p-7 ring-1 ring-black/5"
        >
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <label className="text-sm font-semibold">
              WhatsApp delivery test
              <input
                name="testRecipient"
                type="tel"
                required
                defaultValue={settings?.whatsappRecipient ?? ''}
                className={inputClass}
              />
            </label>
            <button
              disabled={
                busy || !data.providerConfigured || !settings?.whatsappEnabled
              }
              className="rounded-2xl bg-[#123d2d] px-6 py-3.5 font-bold text-white disabled:opacity-50"
            >
              Send test alert
            </button>
          </div>
        </form>

        <section className="mt-5 rounded-[2rem] bg-white p-7 ring-1 ring-black/5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Administrator PWA test</h2>
              <p className="mt-1 text-sm text-[#6e857a]">
                Sends a real push notification to every active administrator
                device that has enabled notifications.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !settings?.adminPushEnabled}
              onClick={() =>
                void run(
                  () => sendAdminPushTest(),
                  'Administrator PWA test sent.',
                )
              }
              className="rounded-2xl bg-[#d9ff71] px-6 py-3.5 font-bold text-[#123d2d] disabled:opacity-50"
            >
              Send PWA test
            </button>
          </div>
        </section>

        <section className="mt-5 rounded-[2rem] bg-white p-7 ring-1 ring-black/5">
          <h2 className="text-2xl font-semibold">Recent alert attempts</h2>
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
                  <tr key={delivery.id} className="border-t border-black/5">
                    <td className="py-4 pr-4 font-semibold">
                      {delivery.recipient}
                      {delivery.failureReason ? (
                        <span className="mt-1 block max-w-md text-xs font-normal text-red-700">
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
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                retryAdminAlert({ data: { id: delivery.id } }),
                              'Alert retry processed.',
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
                      No administrator alerts have been queued.
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

function Check(props: {
  name: string
  label: string
  checked: boolean
  light?: boolean
}) {
  return (
    <label className="flex items-center gap-3 font-semibold">
      <input
        name={props.name}
        type="checkbox"
        defaultChecked={props.checked}
        className="size-5 accent-[#85ae38]"
      />
      <span className={props.light ? 'text-white' : undefined}>
        {props.label}
      </span>
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-black/5">
      <p className="text-xs font-bold uppercase tracking-wide text-[#6e857a]">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  )
}
