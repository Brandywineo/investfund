import { closePool } from '../src/db/index.js'
import { processEmailOutbox } from '../src/server/email.service.js'

try {
  const result = await processEmailOutbox(25)
  console.log(JSON.stringify(result))
} finally {
  await closePool()
}
