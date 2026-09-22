import { useEffect, useState } from 'react'

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaInstall({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [ios, setIos] = useState(false)
  useEffect(() => {
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js')
    setInstalled(window.matchMedia('(display-mode: standalone)').matches)
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent))
    const listener = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', listener)
    window.addEventListener('appinstalled', () => setInstalled(true))
    return () => window.removeEventListener('beforeinstallprompt', listener)
  }, [])
  if (installed)
    return compact ? null : (
      <p className="text-sm text-green-700">
        InvestFund is installed on this device.
      </p>
    )
  return (
    <div>
      <button
        type="button"
        disabled={!prompt}
        onClick={async () => {
          if (!prompt) return
          await prompt.prompt()
          const choice = await prompt.userChoice
          if (choice.outcome === 'accepted') setInstalled(true)
          setPrompt(null)
        }}
        className="rounded-xl bg-[#123d2d] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        Install InvestFund
      </button>
      {!prompt && ios && (
        <p className="mt-2 text-xs text-[#6e857a]">
          On iPhone: tap Share, then Add to Home Screen.
        </p>
      )}
      {!prompt && !ios && (
        <p className="mt-2 text-xs text-[#6e857a]">
          Use your browser menu and choose Install app if the button is
          unavailable.
        </p>
      )}
    </div>
  )
}
