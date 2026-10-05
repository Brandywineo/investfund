import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import { getLedgerHistory } from '#/server/ledger.functions'

export const Route = createFileRoute('/ledger')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: () => getLedgerHistory(),
  component: LedgerPage,
})

type LedgerFilter =
  'ALL' | 'DEPOSIT' | 'INVESTMENT' | 'PROFIT' | 'REFERRAL' | 'WITHDRAWAL'

const eventPresentation: Record<
  string,
  { title: string; category: Exclude<LedgerFilter, 'ALL'>; tone: string }
> = {
  DEPOSIT_CONFIRMED: {
    title: 'Deposit confirmed',
    category: 'DEPOSIT',
    tone: 'bg-green-100 text-green-800',
  },
  DAILY_ACCRUAL: {
    title: 'Daily profit credited',
    category: 'PROFIT',
    tone: 'bg-lime-100 text-lime-800',
  },
  REFERRAL_COMMISSION_POSTED: {
    title: 'Referral reward credited',
    category: 'REFERRAL',
    tone: 'bg-blue-100 text-blue-800',
  },
  INVESTMENT_ACTIVATED: {
    title: 'Investment started',
    category: 'INVESTMENT',
    tone: 'bg-emerald-100 text-emerald-800',
  },
  INVESTMENT_FUNDS_ADDED: {
    title: 'Funds added to investment',
    category: 'INVESTMENT',
    tone: 'bg-emerald-100 text-emerald-800',
  },
  INVESTMENT_PROFIT_RELEASED: {
    title: 'Profit released',
    category: 'PROFIT',
    tone: 'bg-lime-100 text-lime-800',
  },
  INVESTMENT_EXIT_APPROVED: {
    title: 'Investment stopped',
    category: 'INVESTMENT',
    tone: 'bg-emerald-100 text-emerald-800',
  },
  WITHDRAWAL_RESERVED: {
    title: 'Withdrawal requested',
    category: 'WITHDRAWAL',
    tone: 'bg-amber-100 text-amber-800',
  },
  WITHDRAWAL_RESERVATION_RELEASED: {
    title: 'Withdrawal funds returned',
    category: 'WITHDRAWAL',
    tone: 'bg-red-100 text-red-800',
  },
}

function ledgerDate(value: string) {
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(value))
}

function accountLabel(account: string) {
  if (account === 'AVAILABLE') return 'Available balance'
  if (account === 'INVESTED') return 'Investment balance'
  return account.toLowerCase().replaceAll('_', ' ')
}

function LedgerPage() {
  const data = Route.useLoaderData()
  const [filter, setFilter] = useState<LedgerFilter>('ALL')
  const filtered = data.transactions.filter((transaction) =>
    filter === 'ALL'
      ? true
      : eventPresentation[transaction.eventType]?.category === filter,
  )
  const summaries = [
    ['Deposited', data.summary.deposited],
    ['Investment profit', data.summary.investmentProfit],
    ['Referral rewards', data.summary.referralIncome],
    ['Withdrawn', data.summary.withdrawn],
    ['Withdrawal fees', data.summary.withdrawalFees],
  ]

  return (
    <main className="min-h-screen bg-[#f4f6f2] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Account records
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-.04em]">
              Your ledger
            </h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </div>

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {summaries.map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl bg-white p-4 ring-1 ring-black/5"
            >
              <p className="text-xs text-[#6e857a]">{label}</p>
              <p className="mt-1 text-lg font-semibold">{value} USDT</p>
            </div>
          ))}
        </section>

        <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
          {(
            [
              ['ALL', 'All'],
              ['DEPOSIT', 'Deposits'],
              ['INVESTMENT', 'Investment'],
              ['PROFIT', 'Profit'],
              ['REFERRAL', 'Referrals'],
              ['WITHDRAWAL', 'Withdrawals'],
            ] as Array<[LedgerFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filter === value ? 'bg-[#123d2d] text-white' : 'bg-white ring-1 ring-black/8'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          {filtered.length === 0 ? (
            <p className="rounded-[2rem] bg-white p-10 text-center text-[#6e857a] ring-1 ring-black/5">
              No matching ledger transactions.
            </p>
          ) : (
            filtered.map((transaction) => {
              const presentation = eventPresentation[transaction.eventType] ?? {
                title: transaction.eventType.replaceAll('_', ' ').toLowerCase(),
                category: 'INVESTMENT' as const,
                tone: 'bg-slate-100 text-slate-700',
              }
              const primaryLine = transaction.lines.reduce((largest, line) => {
                const amount = Math.max(Number(line.credit), Number(line.debit))
                const current = Math.max(
                  Number(largest.credit),
                  Number(largest.debit),
                )
                return amount > current ? line : largest
              }, transaction.lines[0])
              const primaryAmount = primaryLine
                ? Math.max(
                    Number(primaryLine.credit),
                    Number(primaryLine.debit),
                  ).toFixed(2)
                : '0.00'
              return (
                <details
                  key={transaction.id}
                  className="group rounded-2xl bg-white ring-1 ring-black/5 open:ring-[#85ae38]/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden md:p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.08em] ${presentation.tone}`}
                        >
                          {presentation.category}
                        </span>
                        <p className="font-semibold capitalize">
                          {presentation.title}
                        </p>
                      </div>
                      <p className="mt-2 text-xs text-[#829088]">
                        {ledgerDate(transaction.effectiveAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <b>{primaryAmount} USDT</b>
                      <span className="text-xl text-[#6e857a] transition-transform group-open:rotate-90">
                        ›
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-black/6 px-4 pb-4 pt-3 md:px-5 md:pb-5">
                    <p className="mb-3 text-xs text-[#6e857a]">
                      Transaction movements
                    </p>
                    <div className="space-y-2">
                      {transaction.lines.map((line, index) => {
                        const credited = Number(line.credit) > 0
                        const amount = credited
                          ? Number(line.credit)
                          : Number(line.debit)
                        return (
                          <div
                            key={`${transaction.id}-${index}`}
                            className="flex items-center justify-between gap-6 rounded-xl bg-[#f4f6f2] px-4 py-3 text-sm"
                          >
                            <span className="capitalize text-[#557065]">
                              {accountLabel(line.account)}
                            </span>
                            <b className={credited ? 'text-green-700' : ''}>
                              {credited ? '+' : '−'}
                              {amount.toFixed(2)} USDT
                            </b>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </details>
              )
            })
          )}
        </div>
      </div>
    </main>
  )
}
