import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  getNotificationCenter,
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

function decodeKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

function NotificationPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
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
    setMessage('Notifications are disabled on this device.')
  }
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
        <section className="mt-8 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-xl font-semibold">Push notifications</h2>
          <p className="mt-2 text-sm text-[#6e857a]">
            Permission is requested only when you press enable. Financial
            actions are never performed from a notification.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() => void enable()}
              className="rounded-xl bg-[#123d2d] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Enable on this device
            </button>
            <button
              onClick={() => void disable()}
              className="rounded-xl border border-black/10 px-5 py-3 text-sm font-bold"
            >
              Disable on this device
            </button>
          </div>
          {message && <p className="mt-3 text-sm text-[#557065]">{message}</p>}
          <form
            className="mt-6 grid gap-3 border-t border-black/6 pt-5 sm:grid-cols-2"
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
        </section>
        <section className="mt-5 rounded-[2rem] bg-white p-6 ring-1 ring-black/5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Recent updates {data.unread ? `(${data.unread})` : ''}
            </h2>
            {data.unread > 0 && (
              <button
                className="text-sm font-bold"
                onClick={async () => {
                  await markNotificationsRead()
                  await router.invalidate()
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="mt-4 divide-y divide-black/6">
            {data.items.length ? (
              data.items.map((item) => (
                <Link
                  to={item.href as '/app'}
                  key={item.id}
                  className="block py-4"
                >
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-sm text-[#557065]">{item.body}</p>
                    </div>
                    {!item.readAt && (
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-[#85ae38]" />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-[#83958d]">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </Link>
              ))
            ) : (
              <p className="py-5 text-sm text-[#6e857a]">
                No notifications yet.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
