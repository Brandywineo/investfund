import { runAccrualBatch } from '../src/server/accrual.service'
import { closePool } from '../src/db'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

try {
  const result = await runAccrualBatch()
  console.log(JSON.stringify(result))
  if (result.failures.length > 0) process.exitCode = 1
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Accrual batch failed')
  process.exitCode = 1
} finally {
  await closePool()
}
