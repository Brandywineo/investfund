import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  draftControlledWalletTransfer,
  getControlledWalletTransferDashboard,
  reviewControlledWalletTransfer,
} from '#/server/controlled-wallet-transfer.functions'
import {
  advanceTreasuryTransfer,
  createTreasuryTransfer,
} from '#/server/custody.functions'
import { FullAddress, PasteButton } from '#/components/AddressActions'

export const Route = createFileRoute('/admin_/wallet-transfers')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getControlledWalletTransferDashboard(),
  component: WalletTransfersPage,
})

function WalletTransfersPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [internalSource, setInternalSource] = useState<
    'SWEEP_GAS' | 'HOT_WITHDRAWAL'
  >('SWEEP_GAS')
  const [externalBnbAddress, setExternalBnbAddress] = useState('')
  const [externalUsdtAddress, setExternalUsdtAddress] = useState('')

  const hot = data.wallets.find((wallet) => wallet.role === 'HOT_WITHDRAWAL')
  const gas = data.wallets.find((wallet) => wallet.role === 'SWEEP_GAS')
  const internalDestination = internalSource === 'SWEEP_GAS' ? hot : gas
  const internalSourceWallet = internalSource === 'SWEEP_GAS' ? gas : hot
  const internalMaximum = useMemo(
    () =>
      Math.max(
        0,
        Number(internalSourceWallet?.nativeBalance ?? 0) -
          Number(data.estimatedNativeFeeBnb),
      ).toFixed(8),
    [data.estimatedNativeFeeBnb, internalSourceWallet?.nativeBalance],
  )

  async function run(
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusyId(id)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed')
    } finally {
      setBusyId('')
    }
  }

  function draftBnb(
    event: FormEvent<HTMLFormElement>,
    type: 'INTERNAL' | 'EXTERNAL',
  ) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      `draft-${type}`,
      () =>
        draftControlledWalletTransfer({
          data: {
            sourceRole: type === 'INTERNAL' ? internalSource : 'HOT_WITHDRAWAL',
            destinationType: type,
            destinationAddress:
              type === 'EXTERNAL' ? String(form.get('destination')) : undefined,
            amount: String(form.get('amount')),
            reason: String(form.get('reason')),
          },
        }),
      'BNB transfer drafted. Review the full details below before approval.',
    )
  }

  function draftUsdt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      'draft-usdt',
      () =>
        createTreasuryTransfer({
          data: {
            amount: String(form.get('amount')),
            destination: String(form.get('destination')),
            reason: String(form.get('reason')),
            purpose: String(form.get('purpose')) as
              | 'MT5_CAPITAL'
              | 'ADMIN_RESERVE'
              | 'WITHDRAWAL_LIQUIDITY'
              | 'OPERATIONS'
              | 'OTHER',
          },
        }),
      'USDT transfer drafted. Review the full details below before approval.',
    )
  }

  const input =
    'mt-2 w-full rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-2.5 outline-none focus:border-[#85ae38]'

  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Controlled wallet transfers
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#6e857a]">
              Every movement is manually drafted, reviewed and approved. No
              balance automatically triggers a platform-wallet transfer.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/admin/wallets">Platform wallets</Link>
            <Link to="/admin/custody">Custody</Link>
            <Link to="/admin">Controls</Link>
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

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          {[hot, gas].filter(Boolean).map((wallet) => (
            <article key={wallet!.id} className="rounded-[2rem] bg-white p-6">
              <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
                {wallet!.role === 'HOT_WITHDRAWAL'
                  ? 'Hot / withdrawal wallet'
                  : 'Sweep fee wallet'}
              </p>
              <FullAddress value={wallet!.address} />
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#6e857a]">USDT</p>
                  <b>{Number(wallet!.tokenBalance).toFixed(8)}</b>
                </div>
                <div>
                  <p className="text-xs text-[#6e857a]">BNB</p>
                  <b>{Number(wallet!.nativeBalance).toFixed(8)}</b>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-3">
          <form
            onSubmit={(event) => void draftBnb(event, 'INTERNAL')}
            className="rounded-[2rem] bg-[#123d2d] p-6 text-white"
          >
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#d9ff71]">
              Internal · BNB
            </p>
            <h2 className="mt-2 text-xl font-semibold">Move platform gas</h2>
            <label className="mt-5 block text-sm font-semibold">
              From
              <select
                value={internalSource}
                onChange={(event) =>
                  setInternalSource(
                    event.target.value as 'SWEEP_GAS' | 'HOT_WITHDRAWAL',
                  )
                }
                className={`${input} text-[#10251c]`}
              >
                <option value="SWEEP_GAS">Sweep fee wallet</option>
                <option value="HOT_WITHDRAWAL">Hot wallet</option>
              </select>
            </label>
            <div className="mt-4 text-sm">
              <p className="font-semibold">To</p>
              <p className="mt-2 break-all rounded-xl bg-white/10 p-3 font-mono text-xs">
                {internalDestination?.address || 'Wallet not initialized'}
              </p>
            </div>
            <label className="mt-4 block text-sm font-semibold">
              Amount
              <input
                name="amount"
                required
                inputMode="decimal"
                className={`${input} text-[#10251c]`}
              />
            </label>
            <p className="mt-2 text-xs text-white/55">
              Maximum after estimated gas: {internalMaximum} BNB
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Reason
              <input
                name="reason"
                required
                placeholder="Fund hot-wallet transaction fees"
                className={`${input} text-[#10251c]`}
              />
            </label>
            <button
              disabled={Boolean(busyId)}
              className="mt-5 w-full rounded-xl bg-[#d9ff71] py-3 font-bold text-[#123d2d]"
            >
              Create review
            </button>
          </form>

          <form
            onSubmit={(event) => void draftBnb(event, 'EXTERNAL')}
            className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
          >
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
              External · BNB
            </p>
            <h2 className="mt-2 text-xl font-semibold">Send from hot wallet</h2>
            <label className="relative mt-5 block text-sm font-semibold">
              Destination
              <input
                name="destination"
                required
                value={externalBnbAddress}
                onChange={(event) => setExternalBnbAddress(event.target.value)}
                className={`${input} pr-24 font-mono text-xs`}
              />
              <PasteButton onPaste={setExternalBnbAddress} />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Amount
              <input
                name="amount"
                required
                inputMode="decimal"
                className={input}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Reason
              <input name="reason" required className={input} />
            </label>
            <button
              disabled={Boolean(busyId)}
              className="mt-5 w-full rounded-xl bg-[#123d2d] py-3 font-bold text-white"
            >
              Create review
            </button>
          </form>

          <form
            onSubmit={(event) => void draftUsdt(event)}
            className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
          >
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
              External · USDT
            </p>
            <h2 className="mt-2 text-xl font-semibold">Send from hot wallet</h2>
            <label className="mt-5 block text-sm font-semibold">
              Purpose
              <select name="purpose" className={input}>
                <option value="MT5_CAPITAL">MT5 capital</option>
                <option value="ADMIN_RESERVE">Admin reserve</option>
                <option value="WITHDRAWAL_LIQUIDITY">
                  Withdrawal liquidity
                </option>
                <option value="OPERATIONS">Operations</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="relative mt-4 block text-sm font-semibold">
              Destination
              <input
                name="destination"
                required
                value={externalUsdtAddress}
                onChange={(event) => setExternalUsdtAddress(event.target.value)}
                className={`${input} pr-24 font-mono text-xs`}
              />
              <PasteButton onPaste={setExternalUsdtAddress} />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Amount
              <input
                name="amount"
                required
                inputMode="decimal"
                className={input}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold">
              Reason
              <input name="reason" required className={input} />
            </label>
            <p className="mt-3 text-xs text-amber-700">
              Requires BNB in the hot wallet to pay the BEP20 network fee.
            </p>
            <button
              disabled={Boolean(busyId)}
              className="mt-5 w-full rounded-xl bg-[#123d2d] py-3 font-bold text-white"
            >
              Create review
            </button>
          </form>
        </section>

        <Queue title="BNB transfer reviews">
          {data.transfers.map((transfer) => (
            <TransferRow
              key={transfer.id}
              title={`${transfer.sourceRole.replaceAll('_', ' ')} → ${transfer.destinationType === 'INTERNAL' ? transfer.destinationRole?.replaceAll('_', ' ') : 'EXTERNAL'}`}
              amount={`${Number(transfer.amount).toFixed(8)} BNB`}
              destination={transfer.destinationAddress}
              reason={transfer.reason}
              status={transfer.status}
              txHash={transfer.txHash}
            >
              {transfer.status === 'DRAFTED' && (
                <div className="flex gap-2">
                  <button
                    disabled={Boolean(busyId)}
                    onClick={() =>
                      void run(
                        transfer.id,
                        () =>
                          reviewControlledWalletTransfer({
                            data: {
                              transferId: transfer.id,
                              action: 'APPROVE',
                            },
                          }),
                        'BNB transfer approved and queued for broadcast.',
                      )
                    }
                    className="rounded-xl bg-[#123d2d] px-4 py-2 text-xs font-bold text-white"
                  >
                    Confirm & send
                  </button>
                  <button
                    disabled={Boolean(busyId)}
                    onClick={() =>
                      void run(
                        transfer.id,
                        () =>
                          reviewControlledWalletTransfer({
                            data: { transferId: transfer.id, action: 'CANCEL' },
                          }),
                        'Draft transfer cancelled.',
                      )
                    }
                    className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-700"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </TransferRow>
          ))}
        </Queue>

        <Queue title="USDT transfer reviews">
          {data.usdtTransfers.map((transfer) => (
            <TransferRow
              key={transfer.id}
              title={`HOT WALLET → EXTERNAL · ${transfer.purpose.replaceAll('_', ' ')}`}
              amount={`${Number(transfer.amount).toFixed(8)} USDT`}
              destination={transfer.destination}
              reason={transfer.reason}
              status={
                transfer.status === 'APPROVED' && !data.hotWalletHasGas
                  ? 'WAITING FOR BNB'
                  : transfer.status
              }
              txHash={transfer.txHash}
            >
              {transfer.status === 'DRAFTED' && (
                <button
                  disabled={Boolean(busyId)}
                  onClick={() =>
                    void run(
                      transfer.id,
                      () =>
                        advanceTreasuryTransfer({
                          data: {
                            transferId: transfer.id,
                            action: 'APPROVE',
                            reference: 'approved on wallet transfer screen',
                          },
                        }),
                      'USDT transfer approved and queued for broadcast.',
                    )
                  }
                  className="rounded-xl bg-[#123d2d] px-4 py-2 text-xs font-bold text-white"
                >
                  Confirm & send
                </button>
              )}
            </TransferRow>
          ))}
        </Queue>

        <p className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          Estimated native-transfer gas reserve: {data.estimatedNativeFeeBnb}{' '}
          BNB. Recommended sweep-fee wallet reserve:{' '}
          {data.recommendedSweepReserveBnb} BNB. The recommendation is a warning
          target, not an automatic restriction.
        </p>
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
      <div className="divide-y divide-black/6">{children}</div>
    </section>
  )
}

function TransferRow(props: {
  title: string
  amount: string
  destination: string
  reason: string
  status: string
  txHash: string | null
  children?: ReactNode
}) {
  return (
    <article className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <b>{props.title}</b>
          <span className="rounded-full bg-[#eef1eb] px-2 py-1 text-[10px] font-bold">
            {props.status}
          </span>
        </div>
        <p className="mt-2 text-sm font-semibold">{props.amount}</p>
        <p className="mt-2 break-all font-mono text-xs text-[#6e857a]">
          {props.destination}
        </p>
        <p className="mt-2 text-xs text-[#6e857a]">{props.reason}</p>
        {props.txHash && (
          <a
            href={`https://bscscan.com/tx/${props.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-bold"
          >
            View transaction ↗
          </a>
        )}
      </div>
      {props.children}
    </article>
  )
}
