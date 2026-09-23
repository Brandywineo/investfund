import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  classifyPlatformTransaction,
  getPlatformWalletDashboard,
} from '#/server/platform-wallet.functions'
import { FullAddress } from '#/components/AddressActions'

export const Route = createFileRoute('/admin_/wallets')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => getPlatformWalletDashboard(),
  component: PlatformWalletsPage,
})

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function label(value: string | null) {
  if (!value) return 'Needs classification'
  return value.replaceAll('_', ' ').toLowerCase()
}

function PlatformWalletsPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [walletFilter, setWalletFilter] = useState('ALL')
  const [directionFilter, setDirectionFilter] = useState('ALL')
  const [assetFilter, setAssetFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [sort, setSort] = useState('NEWEST')
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const transactions = useMemo(() => {
    const filtered = data.transactions.filter(
      (item) =>
        (walletFilter === 'ALL' || item.walletRole === walletFilter) &&
        (directionFilter === 'ALL' || item.direction === directionFilter) &&
        (assetFilter === 'ALL' || item.asset === assetFilter) &&
        (statusFilter === 'ALL' ||
          (statusFilter === 'UNCLASSIFIED'
            ? item.direction === 'INCOMING' && !item.classification
            : item.status === statusFilter)),
    )
    return [...filtered].sort((left, right) => {
      if (sort === 'HIGHEST') return Number(right.amount) - Number(left.amount)
      if (sort === 'LOWEST') return Number(left.amount) - Number(right.amount)
      if (sort === 'OLDEST')
        return +new Date(left.observedAt) - +new Date(right.observedAt)
      return +new Date(right.observedAt) - +new Date(left.observedAt)
    })
  }, [
    data.transactions,
    walletFilter,
    directionFilter,
    assetFilter,
    statusFilter,
    sort,
  ])

  async function classify(
    event: FormEvent<HTMLFormElement>,
    transactionId: string,
  ) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusyId(transactionId)
    setMessage('')
    setError('')
    try {
      await classifyPlatformTransaction({
        data: {
          transactionId,
          classification: String(form.get('classification')) as
            | 'MT5_RETURN'
            | 'WITHDRAWAL_LIQUIDITY'
            | 'RESERVE_TOP_UP'
            | 'OPERATIONS_REFUND'
            | 'OTHER',
          note: String(form.get('note')),
        },
      })
      setMessage('Incoming transaction classified and posted to the ledger.')
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Classification failed')
    } finally {
      setBusyId('')
    }
  }

  const selectClass =
    'rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[#85ae38]'

  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Platform wallets
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#6e857a]">
              Signer-controlled hot and gas wallets. External destinations are
              recorded only on the transfers that leave the platform.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/admin/wallet-transfers">Transfers</Link>
            <Link to="/admin">Controls</Link>
            <Link to="/admin/custody">Custody</Link>
            <Link to="/admin/referrals">Referrals</Link>
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
          {data.wallets.map((wallet) => (
            <article
              key={wallet.id}
              className={`rounded-[2rem] p-6 ${wallet.role === 'HOT_WITHDRAWAL' ? 'bg-[#123d2d] text-white' : 'bg-white'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.16em] opacity-55">
                    {wallet.role === 'HOT_WITHDRAWAL'
                      ? 'Hot / withdrawal wallet'
                      : 'Sweep fee wallet'}
                  </p>
                  <FullAddress
                    value={wallet.address}
                    dark={wallet.role === 'HOT_WITHDRAWAL'}
                  />
                  <p className="mt-1 text-xs opacity-55">
                    {wallet.derivationPath}
                  </p>
                </div>
                <span className="rounded-full bg-[#d9ff71] px-3 py-1 text-xs font-bold text-[#123d2d]">
                  CONTROLLED
                </span>
              </div>
              <div className="mt-8 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs opacity-55">USDT balance</p>
                  <b className="mt-1 block text-2xl">
                    {Number(wallet.tokenBalance).toFixed(8)}
                  </b>
                </div>
                <div>
                  <p className="text-xs opacity-55">BNB balance</p>
                  <b className="mt-1 block text-2xl">
                    {Number(wallet.nativeBalance).toFixed(18)}
                  </b>
                </div>
              </div>
              <p className="mt-5 text-xs opacity-55">
                Updated{' '}
                {wallet.balanceCheckedAt
                  ? new Date(wallet.balanceCheckedAt).toISOString()
                  : 'waiting for chain worker'}
              </p>
            </article>
          ))}
        </section>

        {!data.wallets.length && (
          <p className="mt-8 rounded-2xl bg-amber-50 p-5 text-sm text-amber-800">
            Platform wallets will appear after the signer and chain worker run
            once on this version.
          </p>
        )}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Hot wallet', `${data.summary.hotUsdt} USDT`],
            ['Pending withdrawals', `${data.summary.pendingWithdrawals} USDT`],
            ['Required reserve', `${data.summary.requiredReserve} USDT`],
            [
              'Unclassified incoming',
              `${data.summary.unclassifiedIncoming} USDT · ${data.summary.unclassifiedCount}`,
            ],
            [
              'Sweep gas capacity',
              data.summary.lowGas
                ? `LOW · ${data.summary.gasBnb} BNB`
                : `~${data.summary.estimatedSweeps} sweeps`,
            ],
          ].map(([name, value]) => (
            <article key={name} className="rounded-2xl bg-white p-5">
              <p className="text-xs uppercase text-[#6e857a]">{name}</p>
              <b className="mt-2 block text-lg">{value}</b>
            </article>
          ))}
        </section>

        {data.summary.lowGas && (
          <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Low BNB balance: automatic user-wallet sweeps may stop until the
            sweep fee wallet is funded.
          </p>
        )}

        <section className="mt-5 rounded-[2rem] bg-[#123d2d] p-6 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[#d9ff71]">
                Chain worker
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                RPC and scanner health
              </h2>
              <p className="mt-2 text-sm text-white/60">
                {data.summary.rpcProvider} · {data.summary.rpcEndpointCount}{' '}
                endpoint{data.summary.rpcEndpointCount === 1 ? '' : 's'}
              </p>
            </div>
            <span
              className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                data.summary.rpcHealth === 'HEALTHY'
                  ? 'bg-[#d9ff71] text-[#123d2d]'
                  : data.summary.rpcHealth === 'CATCHING_UP'
                    ? 'bg-amber-200 text-amber-900'
                    : 'bg-red-200 text-red-900'
              }`}
            >
              {data.summary.rpcHealth.replaceAll('_', ' ')}
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                'Active RPC',
                data.summary.activeRpc
                  ? `RPC ${data.summary.activeRpc}`
                  : 'Waiting',
              ],
              ['Failovers', data.summary.rpcFailoverCount.toLocaleString()],
              ['Block lag', data.summary.blockLag.toLocaleString()],
              [
                'Last scanned',
                data.summary.lastScannedBlock?.toLocaleString() ?? 'Waiting',
              ],
              [
                'Observed head',
                data.summary.lastHeadBlock?.toLocaleString() ?? 'Waiting',
              ],
              ['Pending transfers', String(data.summary.pendingChainTransfers)],
              [
                'Last successful run',
                data.summary.lastRunAt
                  ? new Date(data.summary.lastRunAt).toLocaleString()
                  : 'Never',
              ],
              [
                'Last failover',
                data.summary.lastRpcFailoverAt
                  ? new Date(data.summary.lastRpcFailoverAt).toLocaleString()
                  : 'None',
              ],
            ].map(([name, value]) => (
              <div key={name} className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-white/55">{name}</p>
                <b className="mt-1 block break-words text-sm">{value}</b>
              </div>
            ))}
          </div>
          {data.summary.lastError && (
            <p className="mt-4 rounded-2xl bg-red-200 p-4 text-sm text-red-900">
              Last error: {data.summary.lastError}
            </p>
          )}
        </section>

        <section className="mt-8 rounded-[2rem] bg-white p-5 ring-1 ring-black/5 sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#6e857a]">
                On-chain activity
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                Wallet transactions
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={walletFilter}
                onChange={(e) => setWalletFilter(e.target.value)}
                className={selectClass}
              >
                <option value="ALL">All wallets</option>
                <option value="HOT_WITHDRAWAL">Hot wallet</option>
                <option value="SWEEP_GAS">Sweep fee wallet</option>
              </select>
              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                className={selectClass}
              >
                <option value="ALL">All directions</option>
                <option value="INCOMING">Incoming</option>
                <option value="OUTGOING">Outgoing</option>
              </select>
              <select
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                className={selectClass}
              >
                <option value="ALL">All assets</option>
                <option value="USDT">USDT</option>
                <option value="BNB">BNB</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={selectClass}
              >
                <option value="ALL">All statuses</option>
                <option value="UNCLASSIFIED">Needs classification</option>
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="FAILED">Failed</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className={selectClass}
              >
                <option value="NEWEST">Newest</option>
                <option value="OLDEST">Oldest</option>
                <option value="HIGHEST">Highest amount</option>
                <option value="LOWEST">Lowest amount</option>
              </select>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {transactions.map((transaction) => {
              const canClassify =
                transaction.direction === 'INCOMING' &&
                transaction.asset === 'USDT' &&
                !transaction.classification
              return (
                <article
                  key={transaction.id}
                  className="rounded-2xl border border-black/8 p-4"
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center">
                    <div>
                      <p className="text-xs uppercase text-[#6e857a]">
                        {transaction.walletRole === 'HOT_WITHDRAWAL'
                          ? 'Hot wallet'
                          : 'Sweep fee wallet'}
                      </p>
                      <b
                        className={
                          transaction.direction === 'INCOMING'
                            ? 'text-green-700'
                            : 'text-[#10251c]'
                        }
                      >
                        {transaction.direction === 'INCOMING' ? '+' : '-'}
                        {Number(transaction.amount).toFixed(
                          transaction.asset === 'USDT' ? 8 : 18,
                        )}{' '}
                        {transaction.asset}
                      </b>
                    </div>
                    <div className="text-sm">
                      <p>{label(transaction.classification)}</p>
                      <p className="text-xs text-[#6e857a]">
                        {transaction.status} · {transaction.confirmations}{' '}
                        confirmations
                      </p>
                    </div>
                    <div className="text-xs text-[#6e857a]">
                      <p>
                        {transaction.direction === 'INCOMING' ? 'From' : 'To'}{' '}
                        {shortAddress(
                          transaction.direction === 'INCOMING'
                            ? transaction.fromAddress
                            : transaction.toAddress,
                        )}
                      </p>
                      <p>{new Date(transaction.observedAt).toISOString()}</p>
                    </div>
                    <a
                      href={`https://bscscan.com/tx/${transaction.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-bold"
                    >
                      View TX ↗
                    </a>
                  </div>
                  {canClassify && (
                    <form
                      onSubmit={(event) => void classify(event, transaction.id)}
                      className="mt-4 grid gap-2 border-t border-black/8 pt-4 md:grid-cols-[200px_1fr_auto]"
                    >
                      <select name="classification" className={selectClass}>
                        {data.classifications.map((classification) => (
                          <option key={classification} value={classification}>
                            {label(classification)}
                          </option>
                        ))}
                      </select>
                      <input
                        name="note"
                        required
                        minLength={3}
                        maxLength={250}
                        placeholder="Reason for incoming funds"
                        className={selectClass}
                      />
                      <button
                        disabled={busyId === transaction.id}
                        className="rounded-xl bg-[#123d2d] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        Classify & post
                      </button>
                    </form>
                  )}
                </article>
              )
            })}
            {!transactions.length && (
              <p className="py-8 text-center text-sm text-[#6e857a]">
                No transactions match these filters.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
