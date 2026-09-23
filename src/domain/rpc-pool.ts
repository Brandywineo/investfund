export function configuredRpcUrls(environment = process.env) {
  const pooled = environment.BSC_RPC_URLS
    ?.split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const values = pooled?.length ? pooled : [environment.BSC_RPC_URL]
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export function rpcFailureCategory(cause: unknown) {
  const record = (cause ?? {}) as {
    status?: number
    code?: number | string
    message?: string
    info?: {
      responseStatus?: string
      responseBody?: string
      error?: { code?: number | string; message?: string }
    }
    error?: { code?: number | string; message?: string }
  }
  const message = [
    record.message,
    record.info?.responseStatus,
    record.info?.responseBody,
    record.info?.error?.message,
    record.error?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const status = Number(
    record.status || String(record.info?.responseStatus).match(/\d{3}/)?.[0],
  )

  if (
    status === 429 ||
    record.code === -32005 ||
    record.info?.error?.code === 429 ||
    record.info?.error?.code === -32005 ||
    record.error?.code === 429 ||
    record.error?.code === -32005 ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('limit exceeded') ||
    message.includes('compute units per second')
  )
    return 'RATE_LIMIT' as const
  if (
    status === 408 ||
    status === 425 ||
    (status >= 500 && status <= 599) ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('network')
  )
    return 'TRANSIENT' as const
  if (status === 401 || status === 403 || message.includes('unauthorized'))
    return 'AUTHENTICATION' as const
  return 'PERMANENT' as const
}

export function sanitizedRpcHostname(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return 'configured-endpoint'
  }
}
