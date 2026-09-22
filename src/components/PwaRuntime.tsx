import { useEffect, useState } from 'react'

export function PwaRuntime() {
  const [offline, setOffline] = useState(false)
  const [update, setUpdate] = useState<ServiceWorker | null>(null)
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').then((registration) => {
        if (registration.waiting) setUpdate(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (
              worker.state === 'installed' &&
              navigator.serviceWorker.controller
            )
              setUpdate(worker)
          })
        })
      })
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true
          window.location.reload()
        }
      })
    }
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  if (!offline && !update) return null
  return (
    <div
      className={`fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-2xl ${offline ? 'bg-amber-100 text-amber-950' : 'bg-[#123d2d] text-white'}`}
    >
      <span>
        {offline
          ? 'You are offline. Financial actions are unavailable.'
          : 'A new InvestFund version is ready.'}
      </span>
      {update && !offline && (
        <button
          className="shrink-0 rounded-xl bg-[#d9ff71] px-3 py-2 text-xs font-bold text-[#123d2d]"
          onClick={() => update.postMessage({ type: 'SKIP_WAITING' })}
        >
          Update now
        </button>
      )}
    </div>
  )
}
