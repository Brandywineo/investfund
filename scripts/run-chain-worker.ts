import type { ScannerDiagnostics } from '../src/domain/scanner-diagnostics'
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
let exitCode = 0
const diagnostics: Array<ScannerDiagnostics> = []

try {
  const result = await runChainWorker((batch) => diagnostics.push(batch))
  await getDb()
    .insert(chainWorkerRuns)
    .values({
      status: 'SUCCESS',
      diagnostics,
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
    .values({ status: 'FAILED', error: message, startedAt, diagnostics })
    .catch(() => undefined)
  await evaluateOperationalHealth().catch(() => undefined)
  exitCode = 1
} finally {
  // This is a short-lived systemd oneshot command. A stale database, HTTP or
  // library handle must never keep the service in "activating" after the
  // scanner result has been safely recorded, because that blocks the timer's
  // next execution and lets chain lag grow indefinitely.
  await Promise.race([
    closePool(),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ])
}

process.exit(exitCode)
