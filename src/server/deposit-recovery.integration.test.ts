import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as schema from '#/db/schema'
import { confirmDeposit } from './custody.service'

const state = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle<typeof schema>>,
}))
vi.mock('#/db', () => ({ getDb: () => state.db }))
vi.mock('./notification.service', () => ({
  notifyUser: vi.fn(async () => undefined),
}))
const pg = new PGlite()
const userId = randomUUID()
beforeAll(async () => {
  for (const file of readdirSync('drizzle')
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    if (file.startsWith('0027'))
      await pg.exec(
        'INSERT INTO chain_watcher_state(id, chain_id, last_scanned_block) VALUES(1,56,126559479)',
      )
    await pg.exec(readFileSync(`drizzle/${file}`, 'utf8'))
  }
  state.db = drizzle(pg, { schema })
  await state.db.insert(schema.users).values({
    id: userId,
    email: 'recovery@test.invalid',
    passwordHash: 'unused',
    displayName: 'Recovery',
  })
}, 30000)
afterAll(async () => {
  await pg.close()
})
it('preserves the existing checkpoint when separating native scanning', async () => {
  const [stateRow] = await state.db.select().from(schema.chainWatcherState)
  expect(stateRow.lastScannedBlock).toBe(126559479)
  expect(stateRow.lastNativeScannedBlock).toBe(126559479)
})
it('recovers a failed deposit credit and repeated confirmation posts exactly one ledger transaction', async () => {
  const [deposit] = await state.db
    .insert(schema.deposits)
    .values({ userId, amount: '123.45', txHash: '0xrecovery' })
    .returning()
  await expect(confirmDeposit(deposit.id)).rejects.toThrow(
    'Required ledger account is missing',
  )
  expect((await state.db.select().from(schema.deposits))[0].status).toBe(
    'PENDING',
  )
  await state.db
    .insert(schema.ledgerAccounts)
    .values([
      {
        code: 'PLATFORM:HOT_WALLET',
        name: 'Hot',
        type: 'ASSET',
        normalBalance: 'DEBIT',
      },
      {
        code: `USER:${userId}:AVAILABLE`,
        name: 'Available',
        type: 'LIABILITY',
        normalBalance: 'CREDIT',
        ownerUserId: userId,
      },
    ])
    .onConflictDoNothing()
  await confirmDeposit(deposit.id)
  await confirmDeposit(deposit.id)
  const transactions = await state.db.select().from(schema.ledgerTransactions)
  const entries = await state.db.select().from(schema.ledgerEntries)
  expect(transactions).toHaveLength(1)
  expect(entries).toHaveLength(2)
  expect(entries.find((entry) => Number(entry.credit) > 0)?.credit).toBe(
    '123.45000000',
  )
  expect((await state.db.select().from(schema.deposits))[0].status).toBe(
    'CONFIRMED',
  )
})
