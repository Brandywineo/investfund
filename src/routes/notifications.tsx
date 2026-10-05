import { useEffect, useMemo, useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  getNotificationCenter,
  markNotificationRead,
  markNotificationsRead,
  removePushSubscription,
  savePushSubscription,
  updateNotificationPreferences,
} from '#/server/notification.functions'

export const Route = createFileRoute('/notifications')({
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: '/login' })
  },
  loader: () => getNotificationCenter(),
  component: NotificationPage,
})

type NotificationFilter =
  'ALL' | 'UNREAD' | 'TRADING' | 'PROFIT' | 'WALLET' | 'REFERRAL'

function decodeKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

function notificationTime(value: Date | string) {
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(value))
}

function dayGroup(value: Date | string) {
  const zone = 'Africa/Nairobi'
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(
    new Date(value),
  )
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(
    new Date(),
  )
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(
    yesterdayDate,
  )
  if (date === today) return 'Today'
  if (date === yesterday) return 'Yesterday'
  return 'Earlier'
}

const categoryTone: Record<string, string> = {
  TRADING: 'bg-blue-100 text-blue-800',
  PROFIT: 'bg-lime-100 text-lime-800',
  REFERRAL: 'bg-violet-100 text-violet-800',
  WITHDRAWAL: 'bg-amber-100 text-amber-800',
  INVESTMENT: 'bg-emerald-100 text-emerald-800',
  SYSTEM: 'bg-slate-100 text-slate-700',
}

function NotificationPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [filter, setFilter] = useState<NotificationFilter>('ALL')

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setEnabled(false)
        return
      }
      const registration = await navigator.serviceWorker.ready.catch(() => null)
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null
      setEnabled(Boolean(subscription))
    })()
  }, [])

  async function enable() {
    setBusy(true)
    setMessage('')
    try {
      if (!data.vapidPublicKey)
        throw new Error('Push delivery is not configured yet')
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        throw new Error('Push notifications are not supported on this device')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted')
        throw new Error('Notification permission was not granted')
      const registration = await navigator.serviceWorker.register('/sw.js')
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(data.vapidPublicKey),
        }))
      const json = subscription.toJSON()
      await savePushSubscription({
        data: {
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh || '',
          auth: json.keys?.auth || '',
          userAgent: navigator.userAgent,
        },
      })
      setEnabled(true)
      setMessage('Notifications are enabled on this device.')
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Could not enable notifications',
      )
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      await removePushSubscription({
        data: { endpoint: subscription.endpoint },
      })
      await subscription.unsubscribe()
    }
    setEnabled(false)
    setMessage('Notifications are disabled on this device.')
  }

  const filtered = useMemo(
    () =>
      data.items.filter((item) => {
        if (filter === 'ALL') return true
        if (filter === 'UNREAD') return !item.readAt
        if (filter === 'WALLET')
          return item.category === 'WITHDRAWAL' || item.href === '/wallet'
        return item.category === filter
      }),
    [data.items, filter],
  )
  const groups = ['Today', 'Yesterday', 'Earlier']
    .map((label) => ({
      label,
      items: filtered.filter((item) => dayGroup(item.createdAt) === label),
    }))
    .filter((group) => group.items.length)
  const preferences = data.preferences!

  return (
    <main className="min-h-screen bg-[#f4f6f2] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#6e857a]">
              Updates
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-.04em]">
              Notifications
            </h1>
          </div>
          <Link to="/app" className="text-sm font-bold">
            Dashboard →
          </Link>
        </header>

        <details className="group mt-8 rounded-[2rem] bg-white ring-1 ring-black/5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:hidden md:p-6">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Push notifications</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${enabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}
                >
                  {enabled ? 'Enabled' : 'Not enabled'}
                </span>
              </div>
              <p className="mt-1 text-sm text-[#6e857a]">
                Choose which updates reach this device.
              </p>
            </div>
            <span className="text-xl text-[#6e857a] transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <div className="border-t border-black/6 p-5 pt-4 md:p-6">
            <div className="flex flex-wrap gap-3">
              {enabled ? (
                <button
                  onClick={() => void disable()}
                  className="rounded-xl border border-black/10 px-5 py-3 text-sm font-bold"
                >
                  Disable on this device
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => void enable()}
                  className="rounded-xl bg-[#123d2d] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  Enable on this device
                </button>
              )}
            </div>
            {message && (
              <p className="mt-3 text-sm text-[#557065]">{message}</p>
            )}
            <form
              className="mt-5 grid gap-3 border-t border-black/6 pt-5 sm:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                await updateNotificationPreferences({
                  data: {
                    trading: form.has('trading'),
                    profit: form.has('profit'),
                    referral: form.has('referral'),
                    withdrawal: form.has('withdrawal'),
                    investment: form.has('investment'),
                    system: form.has('system'),
                  },
                })
                setMessage('Notification preferences saved.')
                await router.invalidate()
              }}
            >
              {(
                [
                  'trading',
                  'profit',
                  'referral',
                  'withdrawal',
                  'investment',
                  'system',
                ] as const
              ).map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-3 rounded-xl bg-[#f4f6f2] p-3 text-sm font-semibold"
                >
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={preferences[key]}
                  />
                  {key[0].toUpperCase() + key.slice(1)}
                </label>
              ))}
              <button className="rounded-xl bg-[#d9ff71] px-5 py-3 text-sm font-bold sm:col-span-2">
                Save preferences
              </button>
            </form>
          </div>
        </details>

        <section className="mt-5 rounded-[2rem] bg-white p-5 ring-1 ring-black/5 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">
              Updates {data.unread ? `(${data.unread} unread)` : ''}
            </h2>
            {data.unread > 0 && (
              <button
                className="shrink-0 text-sm font-bold"
                onClick={async () => {
                  await markNotificationsRead()
                  await router.invalidate()
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
            {(
              [
                ['ALL', 'All'],
                ['UNREAD', 'Unread'],
                ['TRADING', 'Trading'],
                ['PROFIT', 'Profit'],
                ['WALLET', 'Wallet'],
                ['REFERRAL', 'Referrals'],
              ] as Array<[NotificationFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filter === value ? 'bg-[#123d2d] text-white' : 'bg-[#f4f6f2] text-[#557065]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {groups.length ? (
              groups.map((group) => (
                <div key={group.label} className="mt-5 first:mt-0">
                  <p className="mb-2 text-xs font-bold uppercase tracking-[.12em] text-[#6e857a]">
                    {group.label}
                  </p>
                  <div className="divide-y divide-black/6">
                    {group.items.map((item) => (
                      <Link
                        to={item.href as '/app'}
                        key={item.id}
                        className={`block py-4 ${item.readAt ? 'opacity-70' : ''}`}
                        onClick={async (event) => {
                          if (!item.readAt) {
                            event.preventDefault()
                            await markNotificationRead({
                              data: { notificationId: item.id },
                            })
                            await router.navigate({ to: item.href as '/app' })
                          }
                        }}
                      >
                        <div className="flex justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[.08em] ${categoryTone[item.category]}`}
                              >
                                {item.category}
                              </span>
                              <p className="font-semibold">{item.title}</p>
                            </div>
                            <p className="mt-2 text-sm leading-5 text-[#557065]">
                              {item.body}
                            </p>
                            <p className="mt-2 text-xs text-[#83958d]">
                              {notificationTime(item.createdAt)}
                            </p>
                          </div>
                          {!item.readAt && (
                            <span className="mt-1 size-2 shrink-0 rounded-full bg-[#85ae38]" />
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-[#6e857a]">
                No notifications in this view.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
