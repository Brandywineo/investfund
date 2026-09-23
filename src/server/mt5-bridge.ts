import { mt5HealthPayload, mt5SnapshotPayload } from '#/domain/mt5'

function configuration() {
  const baseUrl = process.env.MT5_BRIDGE_URL?.trim().replace(/\/$/, '')
  const token = process.env.MT5_BRIDGE_TOKEN?.trim()
  if (!baseUrl || !token) throw new Error('MT5 bridge is not configured')
  return { baseUrl, token }
}

async function request(path: string) {
  const { baseUrl, token } = configuration()
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.MT5_BRIDGE_TIMEOUT_MS || 10_000),
  )
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    if (!response.ok)
      throw new Error(`MT5 bridge returned HTTP ${response.status}`)
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function readMt5Bridge(historyFrom?: Date | null) {
  const query = historyFrom
    ? `?historyFrom=${encodeURIComponent(historyFrom.toISOString())}`
    : ''
  const [health, snapshot] = await Promise.all([
    request('/health').then((payload) => mt5HealthPayload.parse(payload)),
    request(`/snapshot${query}`).then((payload) =>
      mt5SnapshotPayload.parse(payload),
    ),
  ])
  if (!health.connected) throw new Error('MT5 terminal is offline')
  return { health, snapshot }
}
