import { useEffect, useRef, useState } from 'react'
import {
  getSupportConversation,
  markSupportRead,
  sendSupportMessage,
} from '#/server/support-chat.functions'
import { formatKenyaDateTime } from '#/domain/display-time'
import {
  supportFileMime,
  SUPPORT_FILE_COUNT,
  SUPPORT_FILE_LIMIT,
} from '#/domain/support-attachments'
import type { SupportAttachment } from '#/domain/support-attachments'

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
  const [files, setFiles] = useState<File[]>([])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const request = useRef<{
    id: string
    body: string
    attachments: SupportAttachment[]
    selectedFiles: File[]
  } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const file = previewIndex === null ? undefined : files[previewIndex]
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [files, previewIndex])
  function selectFiles(selected: File[]) {
    if (!selected.length) return
    if (files.length + selected.length > SUPPORT_FILE_COUNT) {
      setError('Attach up to 5 files per message')
      return
    }
    if (
      selected.some(
        (file) =>
          !supportFileMime(file.name) ||
          file.size > SUPPORT_FILE_LIMIT ||
          !file.size,
      )
    ) {
      setError(
        'Use PNG, JPEG, WebP, PDF, DOCX, XLSX, TXT or CSV files up to 5 MB each',
      )
      return
    }
    setError('')
    request.current = null
    setFiles((previous) => [...previous, ...selected])
  }

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
    setBody('')
    setFiles([])
    request.current = null
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
    try {
      if (
        request.current?.body !== body.trim() ||
        request.current.selectedFiles !== files
      ) {
        const attachments: SupportAttachment[] = []
        // Encode only when sending, one file at a time to reduce peak memory.
        for (const file of files) {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1])
            reader.onerror = () => reject(new Error('File could not be read'))
            reader.readAsDataURL(file)
          })
          attachments.push({
            name: file.name,
            mime: supportFileMime(file.name)!,
            data,
          })
        }
        request.current = {
          id: crypto.randomUUID(),
          body: body.trim(),
          attachments,
          selectedFiles: files,
        }
      }
      await sendSupportMessage({
        data: {
          userId,
          requestId: request.current.id,
          body: request.current.body,
          attachments: request.current.attachments,
        },
      })
      setBody('')
      setFiles([])
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
              {message.hasImage && (
                <a
                  href={`/api/support-images/${message.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block"
                >
                  <img
                    src={`/api/support-images/${message.id}`}
                    alt={message.body}
                    loading="lazy"
                    className="max-h-80 max-w-full rounded-xl object-contain"
                  />
                  <span className="text-xs font-bold">Open full image ↗</span>
                </a>
              )}
              {message.attachments.map((file, index) => (
                <a
                  key={index}
                  href={`/api/support-files/${message.id}/${index}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block rounded-xl border border-black/10 p-3"
                >
                  {file.mime.startsWith('image/') && (
                    <img
                      src={`/api/support-files/${message.id}/${index}`}
                      alt={file.name}
                      loading="lazy"
                      className="max-h-80 max-w-full rounded-xl object-contain"
                    />
                  )}
                  <span className="mt-1 block break-words text-sm font-bold">
                    {file.name}
                  </span>
                  <span className="text-xs text-[#557065]">
                    {(file.size / 1_000_000).toFixed(2)} MB ·{' '}
                    {file.mime.startsWith('image/')
                      ? 'Open image ↗'
                      : 'Download file'}
                  </span>
                </a>
              ))}
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
          disabled={busy}
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
        {admin && (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-bold">
              Attachments ({files.length}/{SUPPORT_FILE_COUNT})
            </p>
            <label className="block text-sm font-bold" htmlFor="support-photos">
              Add photos from gallery
            </label>
            <input
              id="support-photos"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || files.length >= SUPPORT_FILE_COUNT}
              onChange={(event) => {
                selectFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
            <label
              className="block text-sm font-bold"
              htmlFor="support-documents"
            >
              Add documents
            </label>
            <input
              id="support-documents"
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.txt,.csv"
              disabled={busy || files.length >= SUPPORT_FILE_COUNT}
              onChange={(event) => {
                selectFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
            <p className="text-xs text-[#557065]">
              Up to 5 files, 5 MB each: PNG, JPEG, WebP, PDF, DOCX, XLSX, TXT or
              CSV. Add a caption and remove private details before sending.
            </p>
            {files.map((file, index) => (
              <div
                key={index}
                className="rounded-xl border border-black/10 p-3"
              >
                {supportFileMime(file.name)?.startsWith('image/') && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setPreviewIndex(previewIndex === index ? null : index)
                      }
                      className="text-sm font-bold"
                    >
                      {previewIndex === index
                        ? 'Hide preview'
                        : 'Preview image'}
                    </button>
                    {previewIndex === index && previewUrl && (
                      <img
                        src={previewUrl}
                        alt={file.name}
                        className="max-h-48 max-w-full rounded-xl"
                      />
                    )}
                  </>
                )}
                <p className="break-words text-sm font-bold">{file.name}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPreviewIndex(null)
                    request.current = null
                    setFiles((previous) =>
                      previous.filter((_, i) => i !== index),
                    )
                  }}
                  className="mt-2 text-sm font-bold"
                  aria-label={`Remove ${file.name}`}
                >
                  Remove file
                </button>
              </div>
            ))}
          </div>
        )}
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
