import { useEffect, useRef, useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { currentUser } from '#/server/auth.functions'
import {
  createCommunityGroup,
  getCommunity,
  getCommunityRoom,
  joinCommunity,
  moderateCommunity,
  reactToCommunityMessage,
  reportCommunityMessage,
  sendCommunityMessage,
} from '#/server/community.functions'

export const Route = createFileRoute('/community')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/login' })
  },
  loader: () => getCommunity(),
  component: CommunityPage,
})

type Community = Awaited<ReturnType<typeof getCommunity>>
type Group = Community['groups'][number]
type Room = Awaited<ReturnType<typeof getCommunityRoom>>
type Message = Room['messages'][number]
const button =
  'rounded-xl border border-black/10 px-3 py-2 text-xs font-bold disabled:opacity-40'
const input =
  'w-full rounded-xl border border-black/10 bg-[#f8faf7] px-4 py-3 text-sm'
const date = (value: string) =>
  new Date(value).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

function CommunityPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [groupId, setGroupId] = useState(data.groups.at(0)?.id ?? '')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const group =
    data.groups.find((item) => item.id === groupId) ?? data.groups.at(0)
  return (
    <main className="min-h-screen bg-[#eef1eb] px-5 py-8 text-[#10251c] md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Link to="/app" className="text-sm font-bold text-[#557065]">
              ← Dashboard
            </Link>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-.04em]">
              Community
            </h1>
            <p className="mt-2 text-sm text-[#557065]">
              Official updates, trading conversations and your investor
              community.
            </p>
          </div>
          {data.user.role === 'ADMIN' && (
            <Link to="/admin" className="text-sm font-bold">
              Admin controls →
            </Link>
          )}
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-3">
            {data.groups.map((item) => (
              <button
                key={item.id}
                onClick={() => setGroupId(item.id)}
                aria-pressed={group?.id === item.id}
                className={`w-full rounded-2xl p-5 text-left ${group?.id === item.id ? 'bg-[#123d2d] text-white' : 'bg-white'}`}
              >
                <b className="block">{item.name}</b>
                <span className="mt-2 block text-xs opacity-70">
                  {item.announcementsOnly
                    ? 'Official announcements'
                    : 'Discussion room'}{' '}
                  · {item.memberCount} members
                </span>
              </button>
            ))}
            {data.user.role === 'ADMIN' && (
              <details className="rounded-2xl bg-white p-5">
                <summary className="cursor-pointer text-sm font-bold">
                  Create room
                </summary>
                <form
                  className="mt-4 space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const form = event.currentTarget
                    const fields = new FormData(form)
                    setCreating(true)
                    setError('')
                    try {
                      const result = await createCommunityGroup({
                        data: {
                          name: String(fields.get('name')),
                          description: String(fields.get('description')),
                          announcementsOnly:
                            fields.get('announcementsOnly') === 'on',
                          managerUserId:
                            String(fields.get('managerUserId')) || undefined,
                        },
                      })
                      await router.invalidate()
                      setGroupId(result.id)
                      form.reset()
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Room creation failed',
                      )
                    } finally {
                      setCreating(false)
                    }
                  }}
                >
                  <input
                    name="name"
                    aria-label="Room name"
                    placeholder="Room name"
                    required
                    minLength={3}
                    maxLength={80}
                    className={input}
                  />
                  <textarea
                    name="description"
                    aria-label="Room description"
                    placeholder="Description"
                    maxLength={300}
                    className={input}
                  />
                  <select
                    name="managerUserId"
                    aria-label="Room manager"
                    className={input}
                  >
                    <option value="">Admin moderation</option>
                    {data.managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.name}
                      </option>
                    ))}
                  </select>
                  <label className="flex gap-2 text-xs">
                    <input name="announcementsOnly" type="checkbox" />{' '}
                    Announcements only
                  </label>
                  <button disabled={creating} className={button}>
                    Create room
                  </button>
                  {error && (
                    <p role="alert" className="text-sm text-red-700">
                      {error}
                    </p>
                  )}
                </form>
              </details>
            )}
            <p className="px-2 text-xs leading-6 text-[#557065]">
              Keep account details and wallet recovery phrases private. Room
              moderators can remove messages and mute members.
            </p>
          </aside>
          {group ? (
            <RoomPanel key={group.id} group={group} user={data.user} />
          ) : (
            <div className="rounded-2xl bg-white p-8">
              No community rooms yet.
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function RoomPanel({ group, user }: { group: Group; user: Community['user'] }) {
  const [room, setRoom] = useState<Room | null>(null)
  const [joined, setJoined] = useState(Boolean(group.joinedAt))
  const [body, setBody] = useState('')
  const [imageData, setImageData] = useState<string | undefined>()
  const [readingImage, setReadingImage] = useState(false)
  const [reply, setReply] = useState<Message | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [olderLoaded, setOlderLoaded] = useState(false)
  const router = useRouter()
  const history = useRef(false)
  const alive = useRef(true)
  const requestId = useRef<string | null>(null)
  const muted = Boolean(
    group.mutedUntil && new Date(group.mutedUntil) > new Date(),
  )
  const mayPost =
    joined && !muted && (!group.announcementsOnly || group.canModerate)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    alive.current = true
    let current = true
    let inFlight = false
    async function fetchRoom() {
      if (inFlight) return
      inFlight = true
      try {
        const next = await getCommunityRoom({ data: { groupId: group.id } })
        if (current && !history.current) setRoom(next)
      } catch (cause) {
        if (current)
          setError(
            cause instanceof Error ? cause.message : 'Could not load messages',
          )
      } finally {
        inFlight = false
      }
    }
    void fetchRoom()
    const timer = window.setInterval(() => {
      if (!document.hidden && !history.current) void fetchRoom()
    }, 15000)
    return () => {
      current = false
      alive.current = false
      window.clearInterval(timer)
    }
  }, [group.id])

  async function run(action: () => Promise<unknown>, success = '') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (!alive.current) return
      setNotice(success)
      await router.invalidate()
      const next = await getCommunityRoom({ data: { groupId: group.id } })
      // The component can unmount while the room request is in flight.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (alive.current) {
        history.current = false
        setOlderLoaded(false)
        setRoom(next)
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const moderate = (
    action: 'HIDE' | 'PIN' | 'UNPIN' | 'MUTE' | 'UNMUTE' | 'DISMISS_REPORT',
    targetId: string,
  ) =>
    run(() =>
      moderateCommunity({ data: { groupId: group.id, action, targetId } }),
    )

  function renderMessage(message: Message, pinnedView = false) {
    return (
      <article
        key={message.id}
        className={`rounded-2xl p-5 ${pinnedView ? 'border border-[#c8da9d] bg-[#f5fadf]' : 'bg-[#f8faf7]'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <b>{message.authorName}</b>
            {message.authorRole !== 'USER' && (
              <span className="ml-2 rounded-full bg-[#123d2d]/10 px-2 py-1 text-[10px] font-bold">
                {message.authorRole}
              </span>
            )}
            {message.pinned && (
              <span className="ml-2 text-xs font-bold text-[#557065]">
                Pinned
              </span>
            )}
          </p>
          <time className="text-[10px] text-[#6e857a]">
            {date(message.createdAt)} EAT
          </time>
        </div>
        {message.replyToId && (
          <blockquote className="mt-3 border-l-2 border-[#c5d1c7] pl-3 text-xs text-[#6e857a]">
            Reply:{' '}
            {message.replyBody?.slice(0, 150) || 'Image or unavailable message'}
          </blockquote>
        )}
        {message.body && (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
            {message.body}
          </p>
        )}
        {message.hasImage && (
          <a
            href={`/api/community-images/${message.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={`/api/community-images/${message.id}`}
              alt={`Image shared by ${message.authorName}`}
              loading="lazy"
              className="mt-4 max-h-80 max-w-full rounded-xl object-contain"
            />
          </a>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              aria-label={`${reaction.emoji} reaction, ${reaction.count}`}
              aria-pressed={reaction.mine}
              disabled={busy || !joined || muted}
              onClick={() =>
                void run(() =>
                  reactToCommunityMessage({
                    data: {
                      messageId: message.id,
                      emoji: reaction.emoji as '👍' | '❤️' | '🎯',
                      active: !reaction.mine,
                    },
                  }),
                )
              }
              className={`${button} ${reaction.mine ? 'bg-[#d9ff71]' : 'bg-white'}`}
            >
              {reaction.emoji} {reaction.count || ''}
            </button>
          ))}
          {mayPost && (
            <button
              className={button}
              onClick={() => {
                setReply(message)
                requestId.current = null
                fileInput.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                })
              }}
            >
              Reply
            </button>
          )}
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              const reason = window.prompt(
                'Why are you reporting this message?',
              )
              if (reason)
                void run(
                  () =>
                    reportCommunityMessage({
                      data: { messageId: message.id, reason },
                    }),
                  'Report submitted to room moderators.',
                )
            }}
          >
            Report
          </button>
          {group.canModerate && (
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void moderate(message.pinned ? 'UNPIN' : 'PIN', message.id)
              }
            >
              {message.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {(group.canModerate || message.authorUserId === user.id) && (
            <button
              className={`${button} text-red-700`}
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Remove this message from the room? Its moderation record will be retained.',
                  )
                )
                  void moderate('HIDE', message.id)
              }}
            >
              Remove
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <section className="min-w-0 rounded-[2rem] bg-white p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{group.name}</h2>
          <p className="mt-2 text-sm text-[#6e857a]">{group.description}</p>
        </div>
        <button
          className={button}
          disabled={busy}
          onClick={() => void run(async () => {})}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-[#f5fadf] p-4 text-sm">
          {notice}
        </p>
      )}
      {!joined && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-[#eef1eb] p-4">
          <p className="text-sm">Join this room to participate.</p>
          <button
            disabled={busy}
            className={`${button} bg-[#123d2d] text-white`}
            onClick={() =>
              void run(async () => {
                await joinCommunity({ data: { groupId: group.id } })
                if (alive.current) setJoined(true)
              })
            }
          >
            Join room
          </button>
        </div>
      )}
      {muted && (
        <p className="mt-4 text-sm text-red-700">
          You are muted until {date(new Date(group.mutedUntil!).toISOString())}{' '}
          EAT.
        </p>
      )}
      {group.announcementsOnly && !group.canModerate && (
        <p className="mt-4 text-xs text-[#557065]">
          Announcements are published by the admin or assigned room manager.
        </p>
      )}
      {!room && !error && (
        <p role="status" className="py-8 text-sm text-[#6e857a]">
          Loading messages…
        </p>
      )}
      {room && (
        <>
          {room.pinned.length > 0 && (
            <details className="mt-5" open>
              <summary className="cursor-pointer text-xs font-bold uppercase text-[#557065]">
                Pinned updates ({room.pinned.length})
              </summary>
              <div className="mt-3 space-y-3">
                {room.pinned.map((message) => renderMessage(message, true))}
              </div>
            </details>
          )}
          {room.olderCursor && (
            <button
              className={`${button} mt-5`}
              disabled={busy}
              onClick={() => {
                const before = room.olderCursor!
                setBusy(true)
                setError('')
                void getCommunityRoom({ data: { groupId: group.id, before } })
                  .then((next) => {
                    if (alive.current) {
                      history.current = true
                      setOlderLoaded(true)
                      setRoom((current) =>
                        current
                          ? {
                              ...current,
                              messages: [...next.messages, ...current.messages],
                              olderCursor: next.olderCursor,
                            }
                          : next,
                      )
                    }
                  })
                  .catch((cause) => {
                    if (alive.current)
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Could not load older messages',
                      )
                  })
                  .finally(() => {
                    if (alive.current) setBusy(false)
                  })
              }}
            >
              Load older messages
            </button>
          )}
          <div className="mt-5 space-y-4">
            {room.messages.length ? (
              room.messages.map((message) => renderMessage(message))
            ) : (
              <p className="rounded-xl bg-[#f8faf7] p-8 text-center text-sm text-[#6e857a]">
                No messages yet.{' '}
                {mayPost
                  ? 'Start the conversation.'
                  : 'Updates will appear here.'}
              </p>
            )}
          </div>
          {olderLoaded && (
            <p className="mt-3 text-xs text-[#6e857a]">
              Viewing history. Refresh to return to the latest messages.
            </p>
          )}
        </>
      )}
      {mayPost && (
        <form
          className="mt-6 rounded-2xl border border-black/10 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            requestId.current ??= crypto.randomUUID()
            const id = requestId.current
            void run(async () => {
              await sendCommunityMessage({
                data: {
                  groupId: group.id,
                  requestId: id,
                  body,
                  imageData,
                  replyToId: reply?.id,
                },
              })
              if (alive.current) {
                setBody('')
                setImageData(undefined)
                setReply(null)
                requestId.current = null
                if (fileInput.current) fileInput.current.value = ''
              }
            })
          }}
        >
          {reply && (
            <div className="mb-3 flex justify-between gap-3 text-xs text-[#557065]">
              <p>
                Replying to {reply.authorName}:{' '}
                {reply.body.slice(0, 100) || 'Image'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setReply(null)
                  requestId.current = null
                }}
              >
                Cancel reply
              </button>
            </div>
          )}
          <textarea
            aria-label="Message"
            value={body}
            disabled={busy}
            maxLength={2000}
            rows={3}
            onChange={(event) => {
              setBody(event.target.value)
              requestId.current = null
            }}
            placeholder={
              group.announcementsOnly
                ? 'Publish an official update…'
                : 'Write a message…'
            }
            className={input}
          />
          {imageData && (
            <div className="mt-3">
              <img
                src={imageData}
                alt="Attachment preview"
                className="max-h-40 rounded-xl"
              />
              <button
                type="button"
                className="mt-2 text-xs font-bold"
                disabled={busy}
                onClick={() => {
                  setImageData(undefined)
                  requestId.current = null
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                Remove image
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="text-xs text-[#557065]">
              PNG, JPEG or WebP · up to 1 MB
              <input
                ref={fileInput}
                type="file"
                aria-label="Attach image"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || readingImage}
                className="mt-2 block max-w-full text-xs"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setError('')
                  if (
                    !['image/png', 'image/jpeg', 'image/webp'].includes(
                      file.type,
                    ) ||
                    file.size > 1000000
                  ) {
                    setError('Use a PNG, JPEG or WebP image under 1 MB.')
                    event.target.value = ''
                    return
                  }
                  try {
                    setReadingImage(true)
                    const value = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(String(reader.result))
                        reader.onerror = reject
                        reader.readAsDataURL(file)
                      },
                    )
                    if (alive.current) {
                      setImageData(value)
                      requestId.current = null
                    }
                  } catch {
                    if (alive.current) setError('Could not read image')
                  } finally {
                    if (alive.current) setReadingImage(false)
                  }
                }}
              />
            </label>
            <button
              disabled={busy || readingImage || (!body.trim() && !imageData)}
              className="rounded-xl bg-[#123d2d] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy
                ? 'Working…'
                : group.announcementsOnly
                  ? 'Publish update'
                  : 'Send message'}
            </button>
          </div>
        </form>
      )}
      {group.canModerate && room && (
        <details className="mt-6 rounded-2xl border border-black/10 p-4">
          <summary className="cursor-pointer text-sm font-bold">
            Moderation · {room.reports.length} open reports
          </summary>
          <div className="mt-4 space-y-3">
            {room.reports.map((report) => (
              <div key={report.id} className="rounded-xl bg-red-50 p-3 text-sm">
                <p className="font-bold">{report.reason}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs">
                  {report.body.slice(0, 250) || 'Image message'}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() => void moderate('HIDE', report.messageId)}
                  >
                    Remove message
                  </button>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() => void moderate('DISMISS_REPORT', report.id)}
                  >
                    Dismiss report
                  </button>
                </div>
              </div>
            ))}
            {room.reports.length === 0 && (
              <p className="text-xs text-[#6e857a]">No open reports.</p>
            )}
            <h3 className="pt-3 text-sm font-bold">Members (up to 250)</h3>
            {room.members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>
                  {member.name}
                  {member.mutedUntil && new Date(member.mutedUntil) > new Date()
                    ? ' · muted'
                    : ''}
                </span>
                {member.id !== user.id && (
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      void moderate(
                        member.mutedUntil &&
                          new Date(member.mutedUntil) > new Date()
                          ? 'UNMUTE'
                          : 'MUTE',
                        member.id,
                      )
                    }
                  >
                    {member.mutedUntil &&
                    new Date(member.mutedUntil) > new Date()
                      ? 'Unmute'
                      : 'Mute 24h'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
