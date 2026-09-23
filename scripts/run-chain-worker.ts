import { eq } from 'drizzle-orm'
import { closePool, getDb } from '../src/db'
import { chainWatcherState } from '../src/db/schema'
import { runChainWorker } from '../src/server/chain-worker.service'

function safeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Chain worker failed'
  return message
    .replace(/https?:\/\/[^\s"']+/gi, '[RPC endpoint]')
    .replace(/(api[-_]?key|token)=?[^\s,}]+/gi, '$1=[redacted]')
    .slice(0, 1_000)
}

try {
  console.log(JSON.stringify(await runChainWorker()))
} catch (cause) {
  const message = safeError(cause)
  console.error(message)
  await getDb()
    .update(chainWatcherState)
    .set({ lastError: message, updatedAt: new Date() })
    .where(eq(chainWatcherState.id, 1))
    .catch(() => undefined)
  process.exitCode = 1
} finally {
  await closePool()
}
