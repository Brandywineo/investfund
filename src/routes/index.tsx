import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const activity = [
    ['Daily accrual posted', '+20.40 USDT', 'Today, 00:05'],
    ['Investment activated', '1,000.00 USDT', '20 Sep, 14:22'],
    ['Deposit confirmed', '1,200.00 USDT', '20 Sep, 13:48'],
  ]

  return (
    <main className="min-h-screen bg-[#f4f6f2] text-[#10251c]">
      <nav className="border-b border-black/8 bg-[#f4f6f2]/90 px-5 py-4 backdrop-blur md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#123d2d] text-lg font-black text-[#d9ff71]">I</div>
            <span className="text-lg font-semibold tracking-tight">InvestFund</span>
          </div>
          <div className="hidden items-center gap-8 text-sm text-[#557065] md:flex">
            <span className="font-semibold text-[#123d2d]">Overview</span>
            <span>Invest</span><span>Trading</span><span>Community</span><span>Wallet</span>
          </div>
          <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-black/8">KD</button>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#648174]">Monday, 21 September</p>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">Good morning, Kelvin.</h1>
          </div>
          <button className="w-fit rounded-full bg-[#d9ff71] px-6 py-3 text-sm font-bold text-[#123d2d] shadow-[0_8px_30px_rgba(133,176,31,.2)]">Start investing</button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <article className="overflow-hidden rounded-[2rem] bg-[#123d2d] p-7 text-white shadow-[0_24px_70px_rgba(18,61,45,.18)] md:p-10">
            <div className="flex items-start justify-between">
              <div><p className="text-sm text-white/60">Total portfolio</p><p className="mt-3 text-4xl font-semibold tracking-[-0.04em] md:text-6xl">$1,240.40</p></div>
              <span className="rounded-full bg-[#d9ff71]/15 px-3 py-1.5 text-xs font-bold text-[#d9ff71]">+2.00% today</span>
            </div>
            <div className="mt-12 grid grid-cols-2 gap-4 border-t border-white/12 pt-6 md:grid-cols-4">
              {[['Active investment','$1,020.00'],['Available','$220.40'],["Today's accrual",'+$20.40'],['Daily rate','2.00%']].map(([label,value]) => <div key={label}><p className="text-xs text-white/50">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}
            </div>
          </article>

          <article className="rounded-[2rem] bg-[#e2e9d9] p-7 md:p-8">
            <p className="text-sm font-semibold text-[#557065]">Current investment</p>
            <div className="mt-8 flex items-end justify-between"><div><p className="text-3xl font-semibold">Day 2</p><p className="mt-1 text-sm text-[#557065]">Compounding daily</p></div><div className="grid size-16 place-items-center rounded-full bg-white text-sm font-bold shadow-sm">2%</div></div>
            <div className="mt-8 h-2 overflow-hidden rounded-full bg-black/8"><div className="h-full w-2/3 rounded-full bg-[#85ae38]" /></div>
            <p className="mt-4 text-xs leading-5 text-[#557065]">Rate changes apply forward only. Every daily posting remains visible in your ledger.</p>
          </article>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <article className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-8">
            <div className="flex items-center justify-between"><div><p className="text-sm text-[#557065]">Trading desk</p><h2 className="mt-1 text-xl font-semibold">Weekly strategy</h2></div><span className="flex items-center gap-2 text-xs font-bold text-[#447d42]"><i className="size-2 rounded-full bg-[#61a75e]" /> LIVE</span></div>
            <div className="mt-8 grid grid-cols-2 gap-4"><div className="rounded-2xl bg-[#f4f6f2] p-4"><p className="text-xs text-[#557065]">Open positions</p><p className="mt-2 text-2xl font-semibold">4</p></div><div className="rounded-2xl bg-[#f4f6f2] p-4"><p className="text-xs text-[#557065]">Today</p><p className="mt-2 text-2xl font-semibold text-[#447d42]">+$482</p></div></div>
            <button className="mt-6 text-sm font-bold text-[#123d2d]">View transparent trading →</button>
          </article>

          <article className="rounded-[2rem] bg-white p-7 ring-1 ring-black/5 md:p-8">
            <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Recent activity</h2><button className="text-sm font-semibold text-[#557065]">View ledger</button></div>
            <div className="mt-5 divide-y divide-black/6">{activity.map(([title,amount,time]) => <div className="flex items-center justify-between py-4" key={title}><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-[#83958d]">{time}</p></div><p className="text-sm font-bold">{amount}</p></div>)}</div>
          </article>
        </div>
      </section>
    </main>
  )
}
