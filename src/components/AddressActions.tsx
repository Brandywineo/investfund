import { useState } from 'react'

export function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#d9ff71] px-4 text-xs font-bold text-[#123d2d] transition hover:brightness-95"
      aria-label={`${label} address`}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

export function FullAddress({
  value,
  dark = false,
}: {
  value: string
  dark?: boolean
}) {
  return (
    <div
      className={`mt-3 flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-center ${dark ? 'bg-white/10' : 'bg-[#f4f6f2]'}`}
    >
      <span className="min-w-0 flex-1 break-all font-mono text-sm">
        {value}
      </span>
      <CopyButton value={value} />
    </div>
  )
}

export function PasteButton({ onPaste }: { onPaste: (value: string) => void }) {
  const [pasted, setPasted] = useState(false)

  async function paste() {
    const value = (await navigator.clipboard.readText()).trim()
    onPaste(value)
    setPasted(true)
    window.setTimeout(() => setPasted(false), 1600)
  }

  return (
    <button
      type="button"
      onClick={() => void paste()}
      className="absolute bottom-1.5 right-1.5 h-10 rounded-xl bg-[#e2e9d9] px-4 text-xs font-bold text-[#123d2d]"
    >
      {pasted ? 'Pasted' : 'Paste'}
    </button>
  )
}
