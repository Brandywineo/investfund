import { closePool } from '../src/db'
import { runChainWorker } from '../src/server/chain-worker.service'

try {
  console.log(JSON.stringify(await runChainWorker()))
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Chain worker failed')
  process.exitCode = 1
} finally {
  await closePool()
}
