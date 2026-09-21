import { runAccrualBatch } from '../src/server/accrual.service'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const result = await runAccrualBatch()
console.log(JSON.stringify(result))
if (result.failures.length > 0) process.exitCode = 1
