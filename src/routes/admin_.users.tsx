import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import {
  listUsers,
  listWalletSetOptions,
  rotateUserDepositAddress,
  updateUserAccess,
} from '#/server/admin-users.functions'
import { currentUser } from '#/server/auth.functions'

export const Route = createFileRoute('/admin_/users')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'ADMIN') throw redirect({ to: '/app' })
  },
  loader: async () => ({
    users: await listUsers(),
    walletSets: await listWalletSetOptions(),
  }),
  component: UsersPage,
})

function UsersPage() {
  const { users, walletSets } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [search, setSearch] = useState('')
  const [requestsOnly, setRequestsOnly] = useState(false)
  const visibleUsers = users.filter(
    (user) =>
      `${user.displayName} ${user.email}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!requestsOnly ||
        Number(user.pendingWithdrawalAmount) > 0 ||
        Number(user.pendingExitAmount) > 0),
  )
  async function change(
    userId: string,
    role: 'USER' | 'MANAGER' | 'ADMIN',
    status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED',
  ) {
    setBusyId(userId)
    setError('')
    try {
      await updateUserAccess({ data: { userId, role, status } })
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed')
    } finally {
      setBusyId('')
    }
  }
  async function rotate(userId: string, walletSetId: string) {
    if (!walletSetId) return
    setBusyId(userId)
    setError('')
    try {
      await rotateUserDepositAddress({ data: { userId, walletSetId } })
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rotation failed')
    } finally {
      setBusyId('')
    }
  }
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Users, balances and access
            </h1>
          </div>
          <Link to="/admin" className="text-sm font-bold">
            Controls →
          </Link>
        </div>
        {error && (
          <p className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <p className="mt-5 text-sm text-[#557065]">
          Current balance includes available funds, invested funds and reserved
          withdrawals. Exit requests are already included in invested funds.
          Amounts are in USDT.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <input
            aria-label="Search users"
            placeholder="Search name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requestsOnly}
              onChange={(event) => setRequestsOnly(event.target.checked)}
            />{' '}
            Has withdrawal or exit request
          </label>
          <button
            onClick={() => void router.invalidate()}
            className="text-sm font-bold"
          >
            Refresh balances
          </button>
          <Link to="/admin/withdrawals" className="text-sm font-bold">
            Review withdrawals →
          </Link>
          <Link to="/admin/exits" className="text-sm font-bold">
            Review exits →
          </Link>
        </div>
        <p className="mt-3 text-xs text-[#6e857a]">
          Showing {visibleUsers.length} of {users.length} loaded users (up to
          250).
        </p>
        <div className="mt-8 overflow-x-auto rounded-[2rem] bg-white ring-1 ring-black/5">
          <table className="w-full min-w-[1550px] text-left">
            <thead className="border-b border-black/6 text-xs uppercase tracking-[.12em] text-[#6e857a]">
              <tr>
                <th className="p-5">User</th>
                <th>Joined</th>
                <th>Permanent deposit address</th>
                <th>Current balance</th>
                <th>Money out requests</th>
                <th>Confirmed activity</th>
                <th>Role</th>
                <th>Status</th>
                <th className="pr-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-black/6 last:border-0"
                >
                  <td className="p-5">
                    <b className="block">{user.displayName}</b>
                    <span className="text-xs text-[#6e857a]">{user.email}</span>
                  </td>
                  <td className="text-sm text-[#6e857a]">
                    {new Date(user.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="max-w-72 pr-4 text-xs">
                    {user.depositAddress ? (
                      <div>
                        <button
                          type="button"
                          title="Copy address"
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              user.depositAddress || '',
                            )
                          }
                          className="block max-w-64 truncate font-mono font-semibold hover:underline"
                        >
                          {user.depositAddress}
                        </button>
                        <span className="text-[#6e857a]">
                          {user.walletSetName} · Index {user.derivationIndex} ·{' '}
                          {user.addressStatus}
                        </span>
                        {walletSets.some(
                          (set) =>
                            set.status === 'ACTIVE' &&
                            set.id !== user.walletSetId,
                        ) && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() => {
                              const target = walletSets.find(
                                (set) => set.status === 'ACTIVE',
                              )
                              if (
                                target &&
                                window.confirm(
                                  `Issue a new ${target.name} deposit address? The old address will remain monitored.`,
                                )
                              )
                                void rotate(user.id, target.id)
                            }}
                            className="mt-2 block rounded-lg border border-black/10 px-2 py-1 font-bold"
                          >
                            Switch to active wallet
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#6e857a]">Not issued yet</span>
                    )}
                  </td>
                  <td className="pr-4 text-xs text-[#6e857a]">
                    <b className="block text-base text-[#10251c]">
                      {user.totalBalance} USDT
                    </b>
                    <span className="block">
                      Available {Number(user.availableBalance).toFixed(2)}
                    </span>
                    <span className="block">
                      Invested {Number(user.investedBalance).toFixed(2)}
                    </span>
                    <span className="block">
                      Reserved {Number(user.pendingWithdrawalAmount).toFixed(2)}
                    </span>
                  </td>
                  <td className="pr-4 text-xs text-[#6e857a]">
                    <Link
                      to="/admin/withdrawals"
                      className="block font-bold text-[#10251c]"
                    >
                      Withdrawal{' '}
                      {Number(user.pendingWithdrawalAmount).toFixed(2)} USDT
                    </Link>
                    <span className="block">
                      Net payout {Number(user.pendingWithdrawalNet).toFixed(2)}
                    </span>
                    <Link
                      to="/admin/exits"
                      className="mt-2 block font-bold text-[#10251c]"
                    >
                      Exit {Number(user.pendingExitAmount).toFixed(2)} USDT
                    </Link>
                    <span className="block">Included in invested funds</span>
                  </td>
                  <td className="pr-4 text-xs text-[#6e857a]">
                    <b className="block text-[#10251c]">
                      +{Number(user.confirmedDeposits).toFixed(2)} USDT
                    </b>
                    −{Number(user.confirmedWithdrawals).toFixed(2)} USDT
                  </td>
                  <td>
                    <select
                      id={`role-${user.id}`}
                      defaultValue={user.role}
                      className="rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-2 text-sm"
                    >
                      <option>USER</option>
                      <option>MANAGER</option>
                      <option>ADMIN</option>
                    </select>
                  </td>
                  <td>
                    <select
                      id={`status-${user.id}`}
                      defaultValue={user.status}
                      className="rounded-xl border border-black/10 bg-[#f8faf7] px-3 py-2 text-sm"
                    >
                      <option>ACTIVE</option>
                      <option>SUSPENDED</option>
                      <option>PENDING_VERIFICATION</option>
                    </select>
                  </td>
                  <td className="pr-5 text-right">
                    <button
                      disabled={busyId === user.id}
                      onClick={() => {
                        const role = (
                          document.getElementById(
                            `role-${user.id}`,
                          ) as HTMLSelectElement
                        ).value as 'USER' | 'MANAGER' | 'ADMIN'
                        const status = (
                          document.getElementById(
                            `status-${user.id}`,
                          ) as HTMLSelectElement
                        ).value as
                          'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED'
                        void change(user.id, role, status)
                      }}
                      className="rounded-xl bg-[#123d2d] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="p-8 text-center text-sm text-[#6e857a]"
                  >
                    No users match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
