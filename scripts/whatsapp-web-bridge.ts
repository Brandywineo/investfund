import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { mkdir } from 'node:fs/promises'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'

const host = process.env.WHATSAPP_WEB_BRIDGE_HOST || '127.0.0.1'
const port = Number(process.env.WHATSAPP_WEB_BRIDGE_PORT || 9021)
const token = process.env.WHATSAPP_WEB_BRIDGE_TOKEN?.trim()
const authDirectory =
  process.env.WHATSAPP_WEB_AUTH_DIR ||
  '/home/deno/.config/investfund/whatsapp-web'

if (!token || token.length < 24)
  throw new Error(
    'WHATSAPP_WEB_BRIDGE_TOKEN must contain at least 24 characters',
  )

let socket: ReturnType<typeof makeWASocket> | null = null
let connectionState:
  'CONNECTING' | 'CONNECTED' | 'QR_REQUIRED' | 'DISCONNECTED' = 'DISCONNECTED'
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

async function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  connectionState = 'CONNECTING'
  await mkdir(authDirectory, { recursive: true, mode: 0o700 })
  const { state, saveCreds } = await useMultiFileAuthState(authDirectory)
  const { version } = await fetchLatestBaileysVersion()
  const nextSocket = makeWASocket({
    auth: state,
    version,
    browser: ['InvestFund Alerts', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })
  socket = nextSocket
  nextSocket.ev.on('creds.update', saveCreds)
  nextSocket.ev.on('connection.update', (update) => {
    if (update.qr) {
      connectionState = 'QR_REQUIRED'
      console.log(
        'Scan this QR from WhatsApp > Linked devices > Link a device:',
      )
      qrcode.generate(update.qr, { small: true })
    }
    if (update.connection === 'open') {
      connectionState = 'CONNECTED'
      console.log('InvestFund WhatsApp Web bridge connected')
    }
    if (update.connection === 'close') {
      connectionState = 'DISCONNECTED'
      const statusCode = (
        update.lastDisconnect?.error as {
          output?: { statusCode?: number }
        }
      )?.output?.statusCode
      if (statusCode === DisconnectReason.loggedOut) {
        console.error(
          'WhatsApp logged out. Remove the auth directory and restart to display a new QR.',
        )
        return
      }
      console.warn('WhatsApp disconnected; reconnecting in five seconds')
      reconnectTimer = setTimeout(() => void connect(), 5_000)
    }
  })
}

function authorized(header: string | undefined) {
  return header === `Bearer ${token}`
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 32_768) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    recipient?: string
    message?: string
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json')
  if (!authorized(request.headers.authorization)) {
    response.statusCode = 401
    response.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.end(JSON.stringify({ state: connectionState }))
    return
  }
  if (request.method !== 'POST' || request.url !== '/send') {
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'Not found' }))
    return
  }
  try {
    if (connectionState !== 'CONNECTED' || !socket)
      throw new Error(`WhatsApp is ${connectionState.toLowerCase()}`)
    const body = await requestBody(request)
    const recipient = body.recipient?.replace(/\D/g, '')
    const message = body.message?.trim()
    if (!recipient || recipient.length < 8 || !message)
      throw new Error('A valid recipient and message are required')
    const result = await socket.sendMessage(`${recipient}@s.whatsapp.net`, {
      text: message,
    })
    response.end(JSON.stringify({ messageId: result?.key.id ?? null }))
  } catch (cause) {
    response.statusCode = 503
    response.end(
      JSON.stringify({
        error: cause instanceof Error ? cause.message : 'WhatsApp send failed',
      }),
    )
  }
})

server.listen(port, host, () => {
  console.log(`InvestFund WhatsApp bridge listening on http://${host}:${port}`)
})

void connect()
