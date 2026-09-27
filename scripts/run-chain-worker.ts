import { eq } from 'drizzle-orm'
import { closePool, getDb } from '../src/db'
import { chainWatcherState, chainWorkerRuns } from '../src/db/schema'
import { runChainWorker } from '../src/server/chain-worker.service'
import { evaluateOperationalHealth } from '../src/server/operations.service'

function safeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Chain worker failed'
  return message
    .replace(/https?:\/\/[^\s"']+/gi, '[RPC endpoint]')
    .replace(/(api[-_]?key|token)=?[^\s,}]+/gi, '$1=[redacted]')
    .slice(0, 1_000)
}

const startedAt = new Date()

try {
  const result = await runChainWorker()
  await getDb()
    .insert(chainWorkerRuns)
    .values({
      status: 'SUCCESS',
      fromBlock: result.fromBlock,
      toBlock: result.toBlock,
      headBlock: result.head,
      lagBlocks: Math.max(0, result.head - result.toBlock),
      batches: result.batches,
      runtimeMs: result.runtimeMs,
      rpcEndpointCount: result.rpcEndpoints,
      rpcFailovers: result.rpcFailovers,
      credited: result.credited,
      swept: result.swept,
      startedAt,
    })
  await evaluateOperationalHealth()
  console.log(JSON.stringify(result))
} catch (cause) {
  const message = safeError(cause)
  console.error(message)
  await getDb()
    .update(chainWatcherState)
    .set({ lastError: message, updatedAt: new Date() })
    .where(eq(chainWatcherState.id, 1))
    .catch(() => undefined)
  await getDb()
    .insert(chainWorkerRuns)
    .values({ status: 'FAILED', error: message, startedAt })
    .catch(() => undefined)
  await evaluateOperationalHealth().catch(() => undefined)
  process.exitCode = 1
} finally {
  await closePool()
}
