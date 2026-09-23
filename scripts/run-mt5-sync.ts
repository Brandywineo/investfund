import { closePool } from '../src/db'
import { synchronizeMt5 } from '../src/server/mt5-sync.service'

try {
  console.log(JSON.stringify(await synchronizeMt5()))
} finally {
  await closePool()
}
