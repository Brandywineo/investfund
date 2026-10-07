import { useMemo, useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { CopyButton } from '#/components/AddressActions'
import { formatKenyaDateTime } from '#/domain/display-time'
import { currentUser } from '#/server/auth.functions'
import {
  getAdminWithdrawals,
  reviewWithdrawal,
} from '#/server/custody.functions'

export const Route = createFileRoute('/admin_/withdrawals')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getAdminWithdrawals(),
  component: AdminWithdrawalsPage,
})

type Filter = 'REVIEW' | 'PROGRESS' | 'CONFIRMED' | 'CLOSED' | 'ALL'

const statusStyle: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  BROADCAST: 'bg-violet-100 text-violet-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-slate-200 text-slate-700',
}

function AdminWithdrawalsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('REVIEW')
  const [sources, setSources] = useState<Record<string, string>>({})
  const [reviewing, setReviewing] = useState('')
  const [rejecting, setRejecting] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const rows = useMemo(
    () =>
      data.withdrawals.filter((row) => {
        if (filter === 'REVIEW') return row.status === 'REQUESTED'
        if (filter === 'PROGRESS')
          return ['APPROVED', 'PROCESSING', 'BROADCAST'].includes(row.status)
        if (filter === 'CONFIRMED') return row.status === 'CONFIRMED'
        if (filter === 'CLOSED')
          return ['FAILED', 'REJECTED', 'CANCELLED'].includes(row.status)
        return true
      }),
    [data.withdrawals, filter],
  )

  async function run(
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(id)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      setReviewing('')
      setRejecting('')
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed')
    } finally {
      setBusy('')
    }
  }

  const cards = [
    ['Needs review', String(data.summary.needsReview)],
    ['In progress', String(data.summary.inProgress)],
    ['Gross requested', `${data.summary.pendingGross} USDT`],
    ['Net to send', `${data.summary.pendingNet} USDT`],
    ['Fees retained', `${data.summary.pendingFees} USDT`],
    ['Controlled liquidity', `${data.summary.controlledLiquidity} USDT`],
    ['Funding shortfall', `${data.summary.liquidityShortfall} USDT`],
  ]

  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Withdrawal operations
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#6e857a]">
              Review requests, choose the controlled hot wallet, and follow
              every payment through chain confirmation.
            </p>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm font-bold">
            <Link to="/admin">Controls</Link>
            <Link to="/admin/custody">Custody</Link>
            <Link to="/admin/wallets">Wallets</Link>
            <Link to="/admin/operations">Operations</Link>
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

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {cards.map(([label, value]) => (
            <article
              key={label}
              className="rounded-2xl bg-white p-4 ring-1 ring-black/5"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#6e857a]">
                {label}
              </p>
              <p className="mt-2 text-lg font-semibold">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-5 rounded-[2rem] bg-[#123d2d] p-6 text-white">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-[#d9ff71]">
                Payment sources
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                Controlled hot wallets
              </h2>
            </div>
            <Link
              to="/admin/wallet-transfers"
              className="text-sm font-bold text-[#d9ff71]"
            >
              Fund or transfer wallets →
            </Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {data.wallets.map((wallet) => (
              <article key={wallet.id} className="rounded-2xl bg-white/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{wallet.walletSetName}</p>
                    <p className="mt-1 text-xs text-white/60">
                      {wallet.walletSetStatus}
                    </p>
                  </div>
                  <CopyButton value={wallet.address} />
                </div>
                <p className="mt-4 break-all font-mono text-xs text-white/70">
                  {wallet.address}
                </p>
                <div className="mt-4 flex gap-5 text-sm">
                  <span>
                    <strong>{Number(wallet.tokenBalance).toFixed(2)}</strong>{' '}
                    USDT
                  </span>
                  <span>
                    <strong>{Number(wallet.nativeBalance).toFixed(6)}</strong>{' '}
                    BNB
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="mt-7 flex flex-wrap gap-2">
          {(
            ['REVIEW', 'PROGRESS', 'CONFIRMED', 'CLOSED', 'ALL'] as Filter[]
          ).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded-full px-4 py-2 text-xs font-bold ${filter === item ? 'bg-[#123d2d] text-white' : 'bg-white text-[#496257]'}`}
            >
              {item.replace('_', ' ')}
            </button>
          ))}
        </div>

        <section className="mt-4 grid gap-4">
          {rows.length === 0 && (
            <div className="rounded-[2rem] bg-white p-10 text-center text-[#6e857a]">
              No withdrawals in this view.
            </div>
          )}
          {rows.map((item) => {
            const sourceId =
              sources[item.id] || item.sourcePlatformWalletId || ''
            const source = data.wallets.find((wallet) => wallet.id === sourceId)
            const funded = Boolean(
              source && Number(source.tokenBalance) >= Number(item.netAmount),
            )
            return (
              <article
                key={item.id}
                className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold">{item.userName}</h2>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle[item.status]}`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#6e857a]">
                      {item.userEmail} · {formatKenyaDateTime(item.createdAt)}{' '}
                      EAT
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-5 text-right">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-[#6e857a]">
                        Gross
                      </p>
                      <p className="mt-1 font-semibold">
                        {Number(item.amount).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-[#6e857a]">
                        Fee
                      </p>
                      <p className="mt-1 font-semibold">
                        {Number(item.feeAmount).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-[#6e857a]">
                        Net send
                      </p>
                      <p className="mt-1 font-semibold">
                        {Number(item.netAmount).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
                  <div className="rounded-2xl bg-[#f4f6f2] p-4">
                    <p className="text-[10px] font-bold uppercase text-[#6e857a]">
                      Destination · {item.network}
                    </p>
                    <p className="mt-2 break-all font-mono text-sm">
                      {item.destinationAddress}
                    </p>
                    <div className="mt-3">
                      <CopyButton value={item.destinationAddress} />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#f4f6f2] p-4">
                    <p className="text-[10px] font-bold uppercase text-[#6e857a]">
                      Current user balance
                    </p>
                    <p className="mt-2 text-sm font-bold">
                      Total {item.userBalance.total} USDT
                    </p>
                    <p className="mt-2 text-sm">
                      Available{' '}
                      <strong>
                        {Number(item.userBalance.available).toFixed(2)} USDT
                      </strong>
                    </p>
                    <p className="mt-1 text-sm">
                      Invested{' '}
                      <strong>
                        {Number(item.userBalance.invested).toFixed(2)} USDT
                      </strong>
                    </p>
                    <p className="mt-1 text-sm">
                      Reserved withdrawals{' '}
                      <strong>{item.userBalance.reserved} USDT</strong>
                    </p>
                  </div>
                </div>

                {(source || item.txHash) && item.status !== 'REQUESTED' && (
                  <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#6e857a]">
                      Settlement evidence
                    </p>
                    {source && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold">
                          Source · {source.walletSetName}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs text-[#6e857a]">
                          {source.address}
                        </p>
                      </div>
                    )}
                    {item.txHash && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <p className="min-w-0 flex-1 break-all font-mono text-xs">
                          TXID · {item.txHash}
                        </p>
                        <CopyButton value={item.txHash} label="Copy TXID" />
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#6e857a]">
                      {item.reviewedAt && (
                        <span>
                          Reviewed {formatKenyaDateTime(item.reviewedAt)} EAT
                        </span>
                      )}
                      {item.broadcastAt && (
                        <span>
                          Broadcast {formatKenyaDateTime(item.broadcastAt)} EAT
                        </span>
                      )}
                      {item.confirmedAt && (
                        <span>
                          Confirmed {formatKenyaDateTime(item.confirmedAt)} EAT
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {item.status === 'REQUESTED' && (
                  <div className="mt-5 rounded-2xl border border-black/8 p-4">
                    <label className="text-sm font-semibold">
                      Payment source
                      <select
                        value={sourceId}
                        onChange={(event) =>
                          setSources((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-3"
                      >
                        <option value="">Select controlled hot wallet</option>
                        {data.wallets.map((wallet) => (
                          <option key={wallet.id} value={wallet.id}>
                            {wallet.walletSetName} ·{' '}
                            {Number(wallet.tokenBalance).toFixed(2)} USDT ·{' '}
                            {Number(wallet.nativeBalance).toFixed(6)} BNB
                          </option>
                        ))}
                      </select>
                    </label>
                    {source && (
                      <p
                        className={`mt-2 text-xs ${funded ? 'text-emerald-700' : 'text-red-700'}`}
                      >
                        {funded
                          ? `Ready: ${source.walletSetName} can fund this payment.`
                          : `Short by ${(Number(item.netAmount) - Number(source.tokenBalance)).toFixed(2)} USDT in this wallet.`}
                        {Number(source.nativeBalance) <= 0
                          ? ' BNB gas is also required.'
                          : ''}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        disabled={!funded || busy === item.id}
                        onClick={() => setReviewing(item.id)}
                        className="rounded-xl bg-[#123d2d] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
                      >
                        Review approval
                      </button>
                      <button
                        disabled={busy === item.id}
                        onClick={() =>
                          setRejecting(rejecting === item.id ? '' : item.id)
                        }
                        className="rounded-xl bg-red-50 px-5 py-3 text-sm font-bold text-red-700"
                      >
                        Reject
                      </button>
                    </div>
                    {reviewing === item.id && source && (
                      <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm">
                        <p className="font-semibold">
                          Confirm payment instruction
                        </p>
                        <p className="mt-2">
                          Queue{' '}
                          <strong>
                            {Number(item.netAmount).toFixed(2)} USDT
                          </strong>{' '}
                          from <strong>{source.walletSetName}</strong> to the
                          full destination above. The signer will broadcast it
                          on a worker run.
                        </p>
                        <button
                          disabled={busy === item.id}
                          onClick={() =>
                            void run(
                              item.id,
                              () =>
                                reviewWithdrawal({
                                  data: {
                                    withdrawalId: item.id,
                                    action: 'APPROVE',
                                    sourcePlatformWalletId: source.id,
                                  },
                                }),
                              'Withdrawal approved and queued for broadcast.',
                            )
                          }
                          className="mt-3 rounded-xl bg-[#123d2d] px-5 py-3 font-bold text-white"
                        >
                          Approve and queue
                        </button>
                      </div>
                    )}
                    {rejecting === item.id && (
                      <div className="mt-4">
                        <textarea
                          value={reasons[item.id] || ''}
                          onChange={(event) =>
                            setReasons((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                          placeholder="Reason shown to the user"
                          className="min-h-20 w-full rounded-xl border border-red-200 p-3 text-sm"
                        />
                        <button
                          disabled={
                            (reasons[item.id] || '').trim().length < 3 ||
                            busy === item.id
                          }
                          onClick={() =>
                            void run(
                              item.id,
                              () =>
                                reviewWithdrawal({
                                  data: {
                                    withdrawalId: item.id,
                                    action: 'REJECT',
                                    reference: reasons[item.id],
                                  },
                                }),
                              'Withdrawal rejected and reserved funds released.',
                            )
                          }
                          className="mt-2 rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
                        >
                          Confirm rejection
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {['APPROVED', 'PROCESSING'].includes(item.status) && (
                  <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm text-blue-800">
                    <p>Approved and waiting for the signer/chain worker.</p>
                    <button
                      disabled={busy === item.id}
                      onClick={() =>
                        void run(
                          item.id,
                          () =>
                            reviewWithdrawal({
                              data: {
                                withdrawalId: item.id,
                                action: 'FAIL_APPROVED',
                                reference:
                                  'Broadcast failed before funds were sent',
                              },
                            }),
                          'Payment reservation released.',
                        )
                      }
                      className="mt-3 rounded-xl bg-red-700 px-4 py-2 font-bold text-white"
                    >
                      Release failed payment
                    </button>
                  </div>
                )}
                {item.status === 'BROADCAST' && (
                  <div className="mt-5 rounded-2xl bg-violet-50 p-4 text-sm text-violet-800">
                    <p>
                      Transaction broadcast. Waiting for chain confirmation.
                    </p>
                    <button
                      disabled={busy === item.id}
                      onClick={() =>
                        void run(
                          item.id,
                          () =>
                            reviewWithdrawal({
                              data: {
                                withdrawalId: item.id,
                                action: 'CONFIRM',
                              },
                            }),
                          'Withdrawal confirmed.',
                        )
                      }
                      className="mt-3 rounded-xl bg-[#123d2d] px-4 py-2 font-bold text-white"
                    >
                      Confirm on-chain
                    </button>
                  </div>
                )}
                {item.status === 'FAILED' && (
                  <button
                    disabled={busy === item.id}
                    onClick={() =>
                      void run(
                        item.id,
                        () =>
                          reviewWithdrawal({
                            data: {
                              withdrawalId: item.id,
                              action: 'RELEASE_FAILED',
                              reference:
                                'Administrator verified no transaction was broadcast',
                            },
                          }),
                        'Failed withdrawal reservation released.',
                      )
                    }
                    className="mt-5 rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white"
                  >
                    Release after chain check
                  </button>
                )}
                {item.rejectionReason && (
                  <p className="mt-4 text-sm text-red-700">
                    Reason: {item.rejectionReason}
                  </p>
                )}
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
