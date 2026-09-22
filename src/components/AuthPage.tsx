import type { FormEvent, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

interface AuthPageProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  alternateText: string
  alternateLabel: string
  alternateTo: '/login' | '/signup'
}

export function AuthPage(props: AuthPageProps) {
  return (
    <main className="grid min-h-screen bg-[#f4f6f2] lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden overflow-hidden bg-[#123d2d] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-[#d9ff71] font-black text-[#123d2d]">
            I
          </div>
          <span className="text-lg font-semibold">InvestFund</span>
        </div>
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d9ff71]">
            Built around financial clarity
          </p>
          <p className="mt-5 text-5xl font-semibold leading-[1.08] tracking-[-.045em]">
            Every balance has a source. Every movement has a record.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 text-sm">
            <div>
              <b className="block text-2xl text-[#d9ff71]">24/7</b>
              <span className="text-white/55">Portfolio access</span>
            </div>
            <div>
              <b className="block text-2xl text-[#d9ff71]">USDT</b>
              <span className="text-white/55">Base currency</span>
            </div>
            <div>
              <b className="block text-2xl text-[#d9ff71]">Live</b>
              <span className="text-white/55">Trading visibility</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-white/40">
          Secure sessions · Auditable ledger · Role-based access
        </p>
      </section>
      <section className="flex items-center justify-center p-5 md:p-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-xl bg-[#123d2d] font-black text-[#d9ff71]">
              I
            </div>
            <span className="font-semibold">InvestFund</span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
            {props.eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-.04em]">
            {props.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#6e857a]">
            {props.description}
          </p>
          <div className="mt-8">{props.children}</div>
          <p className="mt-8 text-sm text-[#6e857a]">
            {props.alternateText}{' '}
            <Link className="font-bold text-[#123d2d]" to={props.alternateTo}>
              {props.alternateLabel}
            </Link>
          </p>
        </div>
      </section>
    </main>
  )
}

export function AuthField({
  label,
  name,
  type = 'text',
  autoComplete,
  required = true,
  defaultValue,
}: {
  label: string
  name: string
  type?: string
  autoComplete?: string
  required?: boolean
  defaultValue?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <input
        className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3.5 outline-none transition focus:border-[#85ae38] focus:ring-4 focus:ring-[#85ae38]/15"
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  )
}

export function AuthForm({
  children,
  error,
  busy,
  buttonLabel,
  onSubmit,
}: {
  children: ReactNode
  error: string
  busy: boolean
  buttonLabel: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {children}
      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        disabled={busy}
        className="w-full rounded-2xl bg-[#123d2d] px-5 py-4 font-bold text-white transition hover:bg-[#194d3a] disabled:opacity-60"
      >
        {busy ? 'Please wait…' : buttonLabel}
      </button>
    </form>
  )
}
