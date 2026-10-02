import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { FullAddress, PasteButton } from '#/components/AddressActions'
import { currentUser } from '#/server/auth.functions'
import {
  draftControlledWalletTransfer,
  getControlledWalletTransferDashboard,
  queueDepositGasRecoveryAction,
  replaceStuckTreasuryTransfer,
  reviewControlledWalletTransfer,
} from '#/server/controlled-wallet-transfer.functions'
import { advanceTreasuryTransfer } from '#/server/custody.functions'

export const Route = createFileRoute('/admin_/wallet-transfers')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getControlledWalletTransferDashboard(),
  component: WalletTransfersPage,
})

type TransferType = 'INTERNAL' | 'EXTERNAL'
type Asset = 'USDT' | 'BNB'

function WalletTransfersPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [transferType, setTransferType] = useState<TransferType>('INTERNAL')
  const [asset, setAsset] = useState<Asset>('USDT')
  const [sourceId, setSourceId] = useState(data.wallets.at(0)?.id ?? '')
  const [destinationId, setDestinationId] = useState(
    data.wallets.find((wallet) => wallet.id !== sourceId)?.id ?? '',
  )
  const [externalAddress, setExternalAddress] = useState('')

  const setById = new Map(data.walletSets.map((set) => [set.id, set]))
  const source = data.wallets.find((wallet) => wallet.id === sourceId)
  const destination = data.wallets.find((wallet) => wallet.id === destinationId)
  const maximum = useMemo(() => {
    if (!source) return '0'
    if (asset === 'USDT') return source.tokenBalance
    return Math.max(
      0,
      Number(source.nativeBalance) - Number(data.estimatedNativeFeeBnb),
    ).toFixed(8)
  }, [asset, data.estimatedNativeFeeBnb, source])

  const walletName = (wallet: (typeof data.wallets)[number] | undefined) => {
    if (!wallet) return 'Legacy platform wallet'
    const set = setById.get(wallet.walletSetId)
    return `${set?.name ?? 'Wallet set'} · ${wallet.role === 'HOT_WITHDRAWAL' ? 'Hot / Withdrawal' : 'Sweep Fee'}`
  }

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

  function swapWallets() {
    if (!destinationId) return
    setSourceId(destinationId)
    setDestinationId(sourceId)
  }

  function draftTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    return run(
      'draft-transfer',
      () =>
        draftControlledWalletTransfer({
          data: {
            sourcePlatformWalletId: sourceId,
            destinationType: transferType,
            destinationPlatformWalletId:
              transferType === 'INTERNAL' ? destinationId : undefined,
            destinationAddress:
              transferType === 'EXTERNAL' ? externalAddress : undefined,
            asset,
            amount: String(form.get('amount')),
            purpose: String(form.get('purpose')) as
              | 'WALLET_REBALANCING'
              | 'MT5_CAPITAL'
              | 'ADMIN_RESERVE'
              | 'WITHDRAWAL_LIQUIDITY'
              | 'OPERATIONS'
              | 'OTHER',
            reason: String(form.get('reason')),
          },
        }),
      `${asset} transfer drafted. Review the route below before approval.`,
    )
  }

  const input =
    'mt-2 w-full rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-3 outline-none focus:border-[#85ae38]'

  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Wallet operations
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#6e857a]">
              Move USDT or BNB between controlled wallets, send externally and
              recover unused deposit gas with a complete approval trail.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/admin/wallet-sets">Wallet sets</Link>
            <Link to="/admin/wallets">Platform wallets</Link>
            <Link to="/admin/custody">Custody</Link>
            <Link to="/admin">Controls →</Link>
          </nav>
        </header>

        {(message || error) && (
          <p
            className={`mt-6 rounded-2xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {error || message}
          </p>
        )}

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {data.walletSets.map((set) => (
            <article key={set.id} className="rounded-[2rem] bg-white p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">{set.name}</h2>
                <span className="rounded-full bg-[#eef1eb] px-3 py-1 text-[10px] font-bold">
                  {set.status}
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {data.wallets
                  .filter((wallet) => wallet.walletSetId === set.id)
                  .map((wallet) => (
                    <div
                      key={wallet.id}
                      className="rounded-2xl bg-[#f6f8f4] p-4"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6e857a]">
                        {wallet.role === 'HOT_WITHDRAWAL'
                          ? 'Hot / Withdrawal'
                          : 'Sweep Fee'}
                      </p>
                      <FullAddress value={wallet.address} />
                      <p className="mt-3 text-xs">
                        <b>{Number(wallet.tokenBalance).toFixed(8)}</b> USDT
                      </p>
                      <p className="mt-1 text-xs">
                        <b>{Number(wallet.nativeBalance).toFixed(8)}</b> BNB
                      </p>
                    </div>
                  ))}
              </div>
            </article>
          ))}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <form
            onSubmit={(event) => void draftTransfer(event)}
            className="rounded-[2rem] bg-[#123d2d] p-6 text-white sm:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.14em] text-[#d9ff71]">
                  Controlled transfer
                </p>
                <h2 className="mt-2 text-2xl font-semibold">Move funds</h2>
              </div>
              <div className="flex rounded-xl bg-white/10 p-1 text-xs font-bold">
                {(['INTERNAL', 'EXTERNAL'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTransferType(type)}
                    className={`rounded-lg px-3 py-2 ${transferType === type ? 'bg-[#d9ff71] text-[#123d2d]' : ''}`}
                  >
                    {type === 'INTERNAL'
                      ? 'Between wallets'
                      : 'Send externally'}
                  </button>
                ))}
              </div>
            </div>

            <WalletSelect
              label="From"
              value={sourceId}
              wallets={data.wallets}
              walletSets={data.walletSets}
              onChange={(value) => {
                setSourceId(value)
                if (value === destinationId)
                  setDestinationId(
                    data.wallets.find((wallet) => wallet.id !== value)?.id ??
                      '',
                  )
              }}
            />

            {transferType === 'INTERNAL' ? (
              <>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={swapWallets}
                    className="mt-4 rounded-full border border-white/20 px-4 py-2 text-lg"
                    aria-label="Reverse transfer route"
                  >
                    ⇅
                  </button>
                </div>
                <WalletSelect
                  label="To"
                  value={destinationId}
                  wallets={data.wallets.filter(
                    (wallet) => wallet.id !== sourceId,
                  )}
                  walletSets={data.walletSets}
                  onChange={setDestinationId}
                />
              </>
            ) : (
              <label className="relative mt-5 block text-sm font-semibold">
                Destination address
                <input
                  required
                  value={externalAddress}
                  onChange={(event) => setExternalAddress(event.target.value)}
                  className={`${input} pr-24 font-mono text-xs text-[#10251c]`}
                />
                <PasteButton onPaste={setExternalAddress} />
              </label>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Asset</p>
                <div className="mt-2 grid grid-cols-2 rounded-xl bg-white/10 p-1 text-sm font-bold">
                  {(['USDT', 'BNB'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAsset(option)}
                      className={`rounded-lg py-2.5 ${asset === option ? 'bg-white text-[#123d2d]' : ''}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-sm font-semibold">
                Purpose
                <select name="purpose" className={`${input} text-[#10251c]`}>
                  <option value="WALLET_REBALANCING">Wallet rebalancing</option>
                  <option value="MT5_CAPITAL">MT5 capital</option>
                  <option value="ADMIN_RESERVE">Admin reserve</option>
                  <option value="WITHDRAWAL_LIQUIDITY">
                    Withdrawal liquidity
                  </option>
                  <option value="OPERATIONS">Operations</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block text-sm font-semibold">
              Amount
              <div className="relative">
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  className={`${input} pr-20 text-[#10251c]`}
                />
                <button
                  type="button"
                  onClick={(event) => {
                    const field = event.currentTarget
                      .previousElementSibling as HTMLInputElement | null
                    if (field) field.value = maximum
                  }}
                  className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-xs font-bold text-[#41721a]"
                >
                  MAX
                </button>
              </div>
            </label>
            <p className="mt-2 text-xs text-white/55">
              Available: {Number(maximum).toFixed(8)} {asset}
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Reason
              <input
                name="reason"
                required
                placeholder="Why is this transfer needed?"
                className={`${input} text-[#10251c]`}
              />
            </label>
            <button
              disabled={
                Boolean(busyId) ||
                !source ||
                (transferType === 'INTERNAL' && !destination)
              }
              className="mt-6 w-full rounded-xl bg-[#d9ff71] py-3 font-bold text-[#123d2d] disabled:opacity-50"
            >
              Review transfer
            </button>
          </form>

          <section className="rounded-[2rem] bg-white p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[#6e857a]">
              Deposit gas recovery
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Recover unused BNB</h2>
            <p className="mt-2 text-sm text-[#6e857a]">
              Returns economical BNB balances from deposit addresses to the
              matching wallet set’s sweep-fee wallet.
            </p>
            <div className="mt-5 space-y-3">
              {data.gasPreview.map((preview) => (
                <article
                  key={preview.walletSetId}
                  className="rounded-2xl bg-[#f6f8f4] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <b>{preview.walletSetName}</b>
                    <span className="text-xs text-[#6e857a]">
                      {preview.addressCount} addresses
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[#6e857a]">Estimated recovery</p>
                      <b>{Number(preview.estimatedRecovery).toFixed(8)} BNB</b>
                    </div>
                    <div>
                      <p className="text-[#6e857a]">Estimated fees</p>
                      <b>{Number(preview.estimatedFees).toFixed(8)} BNB</b>
                    </div>
                  </div>
                  <button
                    disabled={Boolean(busyId) || preview.addressCount === 0}
                    onClick={() =>
                      void run(
                        `recover-${preview.walletSetId}`,
                        () =>
                          queueDepositGasRecoveryAction({
                            data: { walletSetId: preview.walletSetId },
                          }),
                        `BNB recovery queued for ${preview.walletSetName}.`,
                      )
                    }
                    className="mt-4 w-full rounded-xl bg-[#123d2d] py-2.5 text-xs font-bold text-white disabled:opacity-35"
                  >
                    Recover to sweep-fee wallet
                  </button>
                </article>
              ))}
            </div>
            <button
              disabled={
                Boolean(busyId) ||
                data.gasPreview.every((preview) => preview.addressCount === 0)
              }
              onClick={() =>
                void run(
                  'recover-all',
                  () => queueDepositGasRecoveryAction({ data: {} }),
                  'BNB recovery queued across all wallet sets.',
                )
              }
              className="mt-4 w-full rounded-xl border border-[#123d2d] py-3 text-sm font-bold disabled:opacity-35"
            >
              Recover from all wallet sets
            </button>
          </section>
        </section>

        <Queue title="Transfer reviews and history">
          {data.transfers.length === 0 && (
            <EmptyRow text="No controlled transfers yet." />
          )}
          {data.transfers.map((transfer) => {
            const transferSource = data.wallets.find(
              (wallet) => wallet.id === transfer.sourcePlatformWalletId,
            )
            const transferDestination = data.wallets.find(
              (wallet) => wallet.id === transfer.destinationPlatformWalletId,
            )
            return (
              <TransferRow
                key={transfer.id}
                title={`${walletName(transferSource)} → ${transfer.destinationType === 'INTERNAL' ? walletName(transferDestination) : 'External wallet'}`}
                amount={`${Number(transfer.amount).toFixed(8)} ${transfer.asset}`}
                destination={transfer.destinationAddress}
                reason={`${transfer.purpose.replaceAll('_', ' ')} · ${transfer.reason}`}
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
                          'Transfer approved and queued for broadcast.',
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
                              data: {
                                transferId: transfer.id,
                                action: 'CANCEL',
                              },
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
            )
          })}
        </Queue>

        <Queue title="Deposit gas recovery history">
          {data.gasRecoveries.length === 0 && (
            <EmptyRow text="No BNB recoveries yet." />
          )}
          {data.gasRecoveries.map((recovery) => {
            const address = data.walletAddresses.find(
              (row) => row.id === recovery.walletAddressId,
            )
            const destinationWallet = data.wallets.find(
              (wallet) => wallet.id === recovery.destinationPlatformWalletId,
            )
            return (
              <TransferRow
                key={recovery.id}
                title={`Deposit address → ${walletName(destinationWallet)}`}
                amount={`${Number(recovery.recoveredAmount ?? 0).toFixed(8)} BNB`}
                destination={address?.address ?? recovery.walletAddressId}
                reason={recovery.failureReason ?? 'Unused deposit gas recovery'}
                status={recovery.status}
                txHash={recovery.txHash}
              />
            )
          })}
        </Queue>

        {data.legacyTransfers.length > 0 && (
          <Queue title="Legacy external USDT history">
            {data.legacyTransfers.map((transfer) => (
              <TransferRow
                key={transfer.id}
                title={`Primary Hot → External · ${transfer.purpose.replaceAll('_', ' ')}`}
                amount={`${Number(transfer.amount).toFixed(8)} USDT`}
                destination={transfer.destination}
                reason={transfer.reason}
                status={transfer.status}
                txHash={transfer.txHash}
                attempts={data.treasuryAttempts.filter(
                  (attempt) => attempt.treasuryTransferId === transfer.id,
                )}
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
                              reference: 'approved on wallet operations screen',
                            },
                          }),
                        'Legacy transfer approved and queued.',
                      )
                    }
                    className="rounded-xl bg-[#123d2d] px-4 py-2 text-xs font-bold text-white"
                  >
                    Confirm & send
                  </button>
                )}
                {transfer.status === 'BROADCAST' &&
                  transfer.broadcastAt &&
                  Date.now() - new Date(transfer.broadcastAt).getTime() >
                    5 * 60_000 && (
                    <button
                      disabled={Boolean(busyId)}
                      onClick={() =>
                        void run(
                          `replace-${transfer.id}`,
                          () =>
                            replaceStuckTreasuryTransfer({
                              data: { transferId: transfer.id },
                            }),
                          'Replacement transaction broadcast with higher gas.',
                        )
                      }
                      className="rounded-xl bg-amber-100 px-4 py-2 text-xs font-bold text-amber-900"
                    >
                      Replace with higher gas
                    </button>
                  )}
              </TransferRow>
            ))}
          </Queue>
        )}

        <p className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          BNB maximums reserve approximately {data.estimatedNativeFeeBnb} BNB
          for network gas. USDT transfers require BNB in the selected source
          wallet. Every action requires review before the signer broadcasts it.
        </p>
      </div>
    </main>
  )
}

function WalletSelect(props: {
  label: string
  value: string
  wallets: Array<{
    id: string
    walletSetId: string
    role: 'HOT_WITHDRAWAL' | 'SWEEP_GAS'
    address: string
    tokenBalance: string
    nativeBalance: string
  }>
  walletSets: Array<{ id: string; name: string; status: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="mt-5 block text-sm font-semibold">
      {props.label}
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-white/15 bg-white px-3 py-3 text-[#10251c] outline-none"
      >
        {props.wallets.map((wallet) => {
          const set = props.walletSets.find(
            (item) => item.id === wallet.walletSetId,
          )
          return (
            <option key={wallet.id} value={wallet.id}>
              {set?.name} ·{' '}
              {wallet.role === 'HOT_WITHDRAWAL'
                ? 'Hot / Withdrawal'
                : 'Sweep Fee'}{' '}
              · {Number(wallet.tokenBalance).toFixed(4)} USDT ·{' '}
              {Number(wallet.nativeBalance).toFixed(6)} BNB
            </option>
          )
        })}
      </select>
    </label>
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

function EmptyRow({ text }: { text: string }) {
  return <p className="p-6 text-sm text-[#6e857a]">{text}</p>
}

function TransferRow(props: {
  title: string
  amount: string
  destination: string
  reason: string
  status: string
  txHash: string | null
  attempts?: Array<{ txHash: string; status: string }>
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
        {props.txHash && props.txHash !== 'SKIPPED' && (
          <a
            href={`https://bscscan.com/tx/${props.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-bold"
          >
            View transaction ↗
          </a>
        )}
        {props.attempts && props.attempts.length > 1 && (
          <details className="mt-3 text-xs text-[#6e857a]">
            <summary className="cursor-pointer font-bold">
              Transaction attempts ({props.attempts.length})
            </summary>
            <div className="mt-2 space-y-2">
              {props.attempts.map((attempt) => (
                <a
                  key={attempt.txHash}
                  href={`https://bscscan.com/tx/${attempt.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all font-mono"
                >
                  {attempt.status}: {attempt.txHash} ↗
                </a>
              ))}
            </div>
          </details>
        )}
      </div>
      {props.children}
    </article>
  )
}
