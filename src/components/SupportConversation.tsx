import { useEffect, useRef, useState } from 'react'
import {
  getSupportConversation,
  markSupportRead,
  sendSupportMessage,
} from '#/server/support-chat.functions'
import { formatKenyaDateTime } from '#/domain/display-time'

type Conversation = Awaited<ReturnType<typeof getSupportConversation>>
export function SupportConversation({
  userId,
  admin = false,
}: {
  userId?: string
  admin?: boolean
}) {
  const [thread, setThread] = useState<Conversation | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const request = useRef<{ id: string; body: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const value = await getSupportConversation({ data: { userId } })
        if (!active) return
        setThread((previous) => {
          if (!previous) return value
          const combined = new Map(
            previous.messages.map((message) => [message.id, message]),
          )
          value.messages.forEach((message) => combined.set(message.id, message))
          return {
            ...value,
            olderCursor: previous.olderCursor ?? value.olderCursor,
            messages: [...combined.values()].sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            ),
          }
        })
        const last = value.messages.at(-1)
        if (last)
          await markSupportRead({ data: { userId, messageId: last.id } })
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load conversation',
          )
      }
    }
    setThread(null)
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [userId])
  async function send() {
    if (!body.trim() || busy) return
    setBusy(true)
    setError('')
    if (request.current?.body !== body.trim())
      request.current = { id: crypto.randomUUID(), body: body.trim() }
    try {
      await sendSupportMessage({
        data: {
          userId,
          requestId: request.current.id,
          body: request.current.body,
        },
      })
      setBody('')
      request.current = null
      const value = await getSupportConversation({ data: { userId } })
      setThread(value)
      end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Message could not be sent. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function older() {
    if (!thread?.olderCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const value = await getSupportConversation({
        data: { userId, before: thread.olderCursor },
      })
      setThread((previous) =>
        previous
          ? {
              ...previous,
              olderCursor: value.olderCursor,
              messages: [
                ...value.messages,
                ...previous.messages.filter(
                  (message) =>
                    !value.messages.some(
                      (olderMessage) => olderMessage.id === message.id,
                    ),
                ),
              ],
            }
          : value,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to load older messages',
      )
    } finally {
      setLoadingOlder(false)
    }
  }
  return (
    <section className="rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-7">
      <h2 className="text-xl font-semibold">
        {admin
          ? (thread?.owner.name ?? 'User conversation')
          : 'Your private support conversation'}
      </h2>
      {admin && (
        <p className="mt-1 text-sm text-[#557065]">{thread?.owner.email}</p>
      )}
      <p className="mt-2 text-sm text-[#557065]">
        Visible only to you and platform administrators. Never send passwords,
        recovery phrases or private keys.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {thread?.olderCursor && (
        <button
          onClick={() => void older()}
          disabled={loadingOlder}
          className="mt-4 text-sm font-bold"
        >
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      )}
      <div
        aria-label="Support messages"
        role="log"
        aria-live="polite"
        className="my-5 max-h-[480px] space-y-4 overflow-y-auto"
      >
        {!thread ? (
          <p className="text-sm text-[#557065]">Loading conversation…</p>
        ) : thread.messages.length === 0 ? (
          <p className="rounded-xl bg-[#f4f6f2] p-4 text-sm">
            {admin
              ? 'Send a message to start this private conversation.'
              : 'Ask about your investment, deposits, withdrawals or using the app. Send your first message below.'}
          </p>
        ) : (
          thread.messages.map((message) => (
            <article
              key={message.id}
              className={`rounded-2xl p-4 ${message.fromAdmin ? 'bg-[#edf4ef]' : 'bg-[#f5f6f4]'}`}
            >
              <div className="flex flex-wrap justify-between gap-2 text-xs text-[#557065]">
                <b>
                  {message.fromAdmin
                    ? 'InvestFund Support'
                    : admin
                      ? thread.owner.name
                      : 'You'}
                </b>
                <span>{formatKenyaDateTime(message.createdAt)} EAT</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {message.body}
              </p>
            </article>
          ))
        )}
        <div ref={end} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label htmlFor="support-message" className="text-sm font-bold">
          Message
        </label>
        <textarea
          id="support-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={4000}
          required
          rows={4}
          placeholder={
            admin
              ? 'Write a reply or start a conversation…'
              : 'How can we help?'
          }
          className="mt-2 w-full rounded-xl border border-black/10 p-3 text-sm"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-[#557065]">
            Replies appear here and in your notification bell.
          </span>
          <button
            disabled={busy || !body.trim() || !thread}
            className="rounded-xl bg-[#123d2d] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </form>
    </section>
  )
}
