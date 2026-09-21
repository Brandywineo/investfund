import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import {
  advanceTreasuryTransfer,
  createTreasuryTransfer,
  getCustodyDashboard,
  reviewDeposit,
  reviewWithdrawal,
  updateCustodySettings,
} from '#/server/custody.functions'
import { currentUser } from '#/server/auth.functions'

export const Route = createFileRoute('/admin_/custody')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getCustodyDashboard(),
  component: CustodyAdminPage,
})

function CustodyAdminPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [refs, setRefs] = useState<Record<string, string>>({})
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }
  function settings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    return run(
      () =>
        updateCustodySettings({
          data: {
            network: String(f.get('network')),
            depositAddress: String(f.get('address')),
            confirmationThreshold: Number(f.get('confirmations')),
            reserveFixed: Number(f.get('fixed')),
            reservePercent: Number(f.get('percent')),
          },
        }),
      'Custody settings updated.',
    )
  }
  function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    return run(
      () =>
        createTreasuryTransfer({
          data: {
            amount: String(f.get('amount')),
            destination: String(f.get('destination')),
          },
        }),
      'Treasury transfer drafted.',
    )
  }
  const input =
    'mt-2 w-full rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-2.5 outline-none'
  const refInput = (id: string, placeholder: string) => (
    <input
      value={refs[id] || ''}
      onChange={(event) =>
        setRefs((current) => ({ ...current, [id]: event.target.value }))
      }
      placeholder={placeholder}
      className="w-full rounded-lg border border-black/10 px-2 py-1.5 text-xs"
    />
  )
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Custody and treasury
            </h1>
          </div>
          <nav className="flex gap-5 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/admin/users">Users</Link>
            <Link to="/app">Dashboard →</Link>
          </nav>
        </header>
        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}
        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {Object.entries(data.summary).map(([key, value]) => (
            <article
              key={key}
              className="rounded-2xl bg-white p-4 ring-1 ring-black/5"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#6e857a]">
                {key.replaceAll(/([A-Z])/g, ' $1')}
              </p>
              <p className="mt-2 text-lg font-semibold">{value}</p>
            </article>
          ))}
        </section>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <form
            onSubmit={settings}
            className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
          >
            <h2 className="text-xl font-semibold">Wallet and reserve policy</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Network
                <input
                  name="network"
                  defaultValue={data.settings.network}
                  className={input}
                />
              </label>
              <label className="text-sm font-semibold">
                Confirmations
                <input
                  name="confirmations"
                  type="number"
                  defaultValue={data.settings.confirmationThreshold}
                  className={input}
                />
              </label>
              <label className="text-sm font-semibold sm:col-span-2">
                Main deposit address
                <input
                  name="address"
                  defaultValue={data.settings.depositAddress || ''}
                  className={input}
                />
              </label>
              <label className="text-sm font-semibold">
                Fixed reserve
                <input
                  name="fixed"
                  type="number"
                  step="0.01"
                  defaultValue={data.settings.reserveFixed}
                  className={input}
                />
              </label>
              <label className="text-sm font-semibold">
                Reserve percentage
                <input
                  name="percent"
                  type="number"
                  step="0.01"
                  defaultValue={data.settings.reservePercent}
                  className={input}
                />
              </label>
            </div>
            <button
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-[#123d2d] py-3 font-bold text-white"
            >
              Save policy
            </button>
          </form>
          <form
            onSubmit={transfer}
            className="rounded-[2rem] bg-[#123d2d] p-6 text-white"
          >
            <h2 className="text-xl font-semibold">Draft MT5 transfer</h2>
            <label className="mt-5 block text-sm font-semibold">
              Amount
              <input
                name="amount"
                required
                className={`${input} text-[#10251c]`}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Broker destination/reference
              <input
                name="destination"
                required
                placeholder="MT5 account or broker destination"
                className={`${input} text-[#10251c]`}
              />
            </label>
            <button
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-[#d9ff71] py-3 font-bold text-[#123d2d]"
            >
              Create draft
            </button>
            <p className="mt-3 text-xs text-white/55">
              Drafting does not move funds. Broadcasting requires a TXID and
              reserve validation.
            </p>
          </form>
        </div>
        <Queue title="Deposits">
          {data.deposits.map((item) => (
            <Row
              key={item.id}
              title={`${item.userEmail} · ${Number(item.amount).toFixed(2)} USDT`}
              status={item.status}
              detail={item.txHash || 'No transaction hash'}
            >
              {item.status === 'PENDING' && (
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          reviewDeposit({
                            data: { depositId: item.id, action: 'CONFIRM' },
                          }),
                        'Deposit confirmed and credited.',
                      )
                    }
                    className="action"
                  >
                    Confirm
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          reviewDeposit({
                            data: {
                              depositId: item.id,
                              action: 'REJECT',
                              reason: 'Transaction could not be verified',
                            },
                          }),
                        'Deposit rejected.',
                      )
                    }
                    className="danger"
                  >
                    Reject
                  </button>
                </div>
              )}
            </Row>
          ))}
        </Queue>
        <Queue title="Withdrawals">
          {data.withdrawals.map((item) => (
            <Row
              key={item.id}
              title={`${item.userEmail} · ${Number(item.amount).toFixed(2)} USDT`}
              status={item.status}
              detail={item.destinationAddress}
            >
              <div className="grid min-w-52 gap-2">
                {item.status === 'REQUESTED' && (
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            reviewWithdrawal({
                              data: {
                                withdrawalId: item.id,
                                action: 'APPROVE',
                              },
                            }),
                          'Withdrawal approved and funds reserved.',
                        )
                      }
                      className="action"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            reviewWithdrawal({
                              data: {
                                withdrawalId: item.id,
                                action: 'REJECT',
                                reference: 'Rejected by administrator',
                              },
                            }),
                          'Withdrawal rejected.',
                        )
                      }
                      className="danger"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {item.status === 'APPROVED' && (
                  <>
                    {refInput(item.id, 'Blockchain TXID')}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            reviewWithdrawal({
                              data: {
                                withdrawalId: item.id,
                                action: 'BROADCAST',
                                reference: refs[item.id],
                              },
                            }),
                          'Withdrawal broadcast recorded.',
                        )
                      }
                      className="action"
                    >
                      Record broadcast
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            reviewWithdrawal({
                              data: {
                                withdrawalId: item.id,
                                action: 'FAIL_APPROVED',
                                reference:
                                  'Broadcast failed before funds were sent',
                              },
                            }),
                          'Reservation released to the user.',
                        )
                      }
                      className="danger"
                    >
                      Release failed payment
                    </button>
                  </>
                )}
                {item.status === 'BROADCAST' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          reviewWithdrawal({
                            data: { withdrawalId: item.id, action: 'CONFIRM' },
                          }),
                        'Withdrawal confirmed.',
                      )
                    }
                    className="action"
                  >
                    Confirm on-chain
                  </button>
                )}
              </div>
            </Row>
          ))}
        </Queue>
        <Queue title="MT5 treasury transfers">
          {data.transfers.map((item) => (
            <Row
              key={item.id}
              title={`${Number(item.amount).toFixed(2)} USDT · ${item.destination}`}
              status={item.status}
              detail={
                item.txHash || item.brokerReference || 'No movement recorded'
              }
            >
              <div className="grid min-w-52 gap-2">
                {item.status === 'DRAFTED' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          advanceTreasuryTransfer({
                            data: {
                              transferId: item.id,
                              action: 'APPROVE',
                              reference: 'approved',
                            },
                          }),
                        'Treasury transfer approved.',
                      )
                    }
                    className="action"
                  >
                    Approve transfer
                  </button>
                )}
                {item.status === 'APPROVED' && (
                  <>
                    {refInput(item.id, 'Blockchain TXID')}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            advanceTreasuryTransfer({
                              data: {
                                transferId: item.id,
                                action: 'BROADCAST',
                                reference: refs[item.id],
                              },
                            }),
                          'Treasury broadcast recorded.',
                        )
                      }
                      className="action"
                    >
                      Broadcast to broker
                    </button>
                  </>
                )}
                {item.status === 'BROADCAST' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          advanceTreasuryTransfer({
                            data: {
                              transferId: item.id,
                              action: 'CHAIN_CONFIRM',
                              reference: 'confirmed',
                            },
                          }),
                        'Blockchain confirmation recorded.',
                      )
                    }
                    className="action"
                  >
                    Confirm on-chain
                  </button>
                )}
                {item.status === 'CONFIRMED' && (
                  <>
                    {refInput(item.id, 'MT5/broker reference')}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            advanceTreasuryTransfer({
                              data: {
                                transferId: item.id,
                                action: 'BROKER_CREDIT',
                                reference: refs[item.id],
                              },
                            }),
                          'Broker credit recorded.',
                        )
                      }
                      className="action"
                    >
                      Confirm broker credit
                    </button>
                  </>
                )}
                {item.status === 'BROKER_CREDITED' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          advanceTreasuryTransfer({
                            data: {
                              transferId: item.id,
                              action: 'RECONCILE',
                              reference: 'reconciled',
                            },
                          }),
                        'Transfer reconciled.',
                      )
                    }
                    className="action"
                  >
                    Reconcile
                  </button>
                )}
              </div>
            </Row>
          ))}
        </Queue>
      </div>
    </main>
  )
}

function Queue({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 overflow-hidden rounded-[2rem] bg-white ring-1 ring-black/5">
      <h2 className="border-b border-black/6 p-6 text-xl font-semibold">
        {title}
      </h2>
      <div className="divide-y divide-black/6">
        {children || <p className="p-6 text-sm text-[#6e857a]">No records.</p>}
      </div>
    </section>
  )
}
function Row({
  title,
  status,
  detail,
  children,
}: {
  title: string
  status: string
  detail: string
  children?: ReactNode
}) {
  return (
    <article className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <b>{title}</b>
          <span className="rounded-full bg-[#eef1eb] px-2 py-1 text-[10px] font-bold">
            {status}
          </span>
        </div>
        <p className="mt-2 break-all text-xs text-[#6e857a]">{detail}</p>
      </div>
      {children}
    </article>
  )
}
