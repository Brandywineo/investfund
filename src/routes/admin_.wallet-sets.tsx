import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { listWalletSets, updateWalletSet } from '#/server/wallet-set.functions'

export const Route = createFileRoute('/admin_/wallet-sets')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: () => listWalletSets(),
  component: WalletSetsPage,
})

function WalletSetsPage() {
  const sets = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function act(
    walletSetId: string,
    action: 'ACTIVATE' | 'DRAIN' | 'RETIRE',
  ) {
    setBusy(walletSetId)
    setError('')
    try {
      await updateWalletSet({ data: { walletSetId, action } })
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet update failed')
    } finally {
      setBusy('')
    }
  }
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Custody
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-.04em]">
              Wallet sets
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[#6e857a]">
              Choose the wallet used for new deposit addresses. Existing
              addresses remain monitored until explicitly rotated.
            </p>
          </div>
          <div className="flex gap-4 text-sm font-bold">
            <Link to="/admin/wallets">Platform wallets</Link>
            <Link to="/admin">Controls →</Link>
          </div>
        </div>
        {error && (
          <p className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {sets.map((set) => (
            <section
              key={set.id}
              className="rounded-[2rem] bg-white p-6 ring-1 ring-black/5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-[#6e857a]">
                    {set.status}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">{set.name}</h2>
                  <p className="mt-1 font-mono text-xs text-[#6e857a]">
                    {set.signerKey} · {set.fingerprint}
                  </p>
                </div>
                <span className="rounded-full bg-[#eef1eb] px-3 py-1 text-xs font-bold">
                  {set.assignedUsers} users
                </span>
              </div>
              <div className="mt-6 grid gap-3">
                {set.wallets.map((wallet) => (
                  <div key={wallet.id} className="rounded-2xl bg-[#f6f8f4] p-4">
                    <b className="text-xs">
                      {wallet.role === 'HOT_WITHDRAWAL'
                        ? 'HOT / WITHDRAWAL'
                        : 'SWEEP FEE'}
                    </b>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard.writeText(wallet.address)
                      }
                      className="mt-1 block break-all text-left font-mono text-xs hover:underline"
                    >
                      {wallet.address}
                    </button>
                    <p className="mt-2 text-xs text-[#6e857a]">
                      {Number(wallet.tokenBalance).toFixed(8)} USDT ·{' '}
                      {Number(wallet.nativeBalance).toFixed(8)} BNB
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {set.status !== 'ACTIVE' && set.status !== 'RETIRED' && (
                  <button
                    disabled={busy === set.id}
                    onClick={() => void act(set.id, 'ACTIVATE')}
                    className="rounded-xl bg-[#123d2d] px-4 py-2 text-sm font-bold text-white"
                  >
                    Make active
                  </button>
                )}
                {set.status === 'READY' && (
                  <button
                    disabled={busy === set.id}
                    onClick={() => void act(set.id, 'DRAIN')}
                    className="rounded-xl border border-black/10 px-4 py-2 text-sm font-bold"
                  >
                    Mark draining
                  </button>
                )}
                {set.status === 'DRAINING' && (
                  <button
                    disabled={busy === set.id}
                    onClick={() => void act(set.id, 'RETIRE')}
                    className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-700"
                  >
                    Retire
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
