import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as schema from '#/db/schema'
import {
  confirmDeposit,
  recordAdminConfirmedDeposit,
  reserveWithdrawalRequest,
  broadcastWithdrawal,
  settleBroadcastWithdrawal,
  releaseApprovedWithdrawal,
} from './custody.service'
import { createInvestment } from './ledger.service'
import {
  register,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  changePassword,
  login,
} from './auth.functions'
import { hashPassword, verifyPassword } from './password'
import { createEmailToken } from './email-token'
import { queueUserReceipt } from './receipt-email.service'
import { processEmailOutbox } from './email.service'

const state = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle<typeof schema>>,
  user: null as { id: string } | null,
}))
vi.mock('#/db', () => ({ getDb: () => state.db }))
vi.mock('./session', () => ({
  getSessionUser: async () => state.user,
  createUserSession: vi.fn(),
  destroyUserSession: vi.fn(),
}))
vi.mock('./notification.service', () => ({
  notifyUser: vi.fn(async () => undefined),
}))
vi.mock('./email-crypto', () => ({ decryptEmailSecret: () => 'test-key' }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: { parse: (value: unknown) => unknown } | undefined
    const builder = {
      validator: (value: typeof validator) => {
        validator = value
        return builder
      },
      handler:
        (handler: (input: { data: unknown }) => unknown) =>
        (input?: { data?: unknown }) =>
          handler({
            data: validator ? validator.parse(input?.data) : input?.data,
          }),
    }
    return builder
  },
}))
const pg = new PGlite()
const ownerId = randomUUID()
const adminId = randomUUID()
beforeAll(async () => {
  vi.stubEnv('APP_ORIGIN', 'https://investfund.site')
  for (const file of readdirSync('drizzle')
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, 'utf8'))
  state.db = drizzle(pg, { schema })
  await state.db.insert(schema.users).values([
    {
      id: ownerId,
      email: 'owner@test.invalid',
      displayName: '<Owner>',
      status: 'ACTIVE',
      passwordHash: await hashPassword('Original123!'),
    },
    {
      id: adminId,
      email: 'admin@test.invalid',
      displayName: 'Admin',
      passwordHash: 'unused',
      role: 'ADMIN',
    },
  ])
  await state.db.insert(schema.ledgerAccounts).values([
    {
      code: `USER:${ownerId}:AVAILABLE`,
      name: 'Available',
      type: 'LIABILITY',
      normalBalance: 'CREDIT',
      ownerUserId: ownerId,
    },
    {
      code: `USER:${ownerId}:INVESTED`,
      name: 'Invested',
      type: 'LIABILITY',
      normalBalance: 'CREDIT',
      ownerUserId: ownerId,
    },
  ])
  await state.db.insert(schema.emailSettings).values({
    id: 1,
    enabled: true,
    verificationRequired: true,
    resetExpiryMinutes: 45,
    encryptedApiKey: 'test',
  })
}, 30000)
afterAll(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await pg.close()
})
async function mail(category: string) {
  return state.db
    .select()
    .from(schema.emailOutbox)
    .where(eq(schema.emailOutbox.category, category))
}

it('queues exactly one credited deposit receipt and none for rolled-back credit', async () => {
  const [deposit] = await state.db
    .insert(schema.deposits)
    .values({ userId: ownerId, amount: '1000.12345678', txHash: '0xreceipt' })
    .returning()
  await confirmDeposit(deposit.id)
  await confirmDeposit(deposit.id)
  const rows = await mail('DEPOSIT_CONFIRMED')
  expect(rows).toHaveLength(1)
  expect(rows[0].recipient).toBe('owner@test.invalid')
  expect(rows[0].textBody).toContain('1000.12345678 USDT')
  expect(rows[0].textBody).toContain('does not automatically start')
  expect(rows[0].htmlBody).toContain('&lt;Owner&gt;')
  await expect(
    state.db.transaction(async (tx) => {
      await queueUserReceipt(tx as never, {
        userId: ownerId,
        eventKey: 'rolled-back',
        category: 'DEPOSIT_CONFIRMED',
        title: 'Test',
        message: 'Test',
      })
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(await mail('DEPOSIT_CONFIRMED')).toHaveLength(1)
})
it('also receipts administrator-recorded credits once and rejects duplicate TXIDs', async () => {
  const input = {
    userId: ownerId,
    amount: '5',
    txHash: '0xadminreceipt',
    receivedInto: 'HOT_WALLET' as const,
    note: 'Confirmed by operator',
    receivedAt: new Date(),
    actorUserId: adminId,
  }
  await recordAdminConfirmedDeposit(input)
  await expect(recordAdminConfirmedDeposit(input)).rejects.toThrow(
    'already attached',
  )
  expect(await mail('DEPOSIT_CONFIRMED')).toHaveLength(2)
})
it('receipts activation only after success, snapshots rate and Kenyan start time, no daily emails', async () => {
  await state.db
    .insert(schema.accrualRates)
    .values({
      dailyRatePercent: '2',
      effectiveFrom: new Date('2026-01-01'),
      createdBy: adminId,
      reason: 'Test rate',
    })
  await createInvestment(ownerId, '300', randomUUID())
  const rows = await mail('INVESTMENT_ACTIVATED')
  expect(rows).toHaveLength(1)
  expect(rows[0].textBody).toContain('300.00000000 USDT')
  expect(rows[0].textBody).toContain('EAT (Kenya)')
  expect(rows[0].textBody).toContain('2.000000%')
  await expect(createInvestment(ownerId, '5000', randomUUID())).rejects.toThrow(
    'Insufficient',
  )
  expect(await mail('INVESTMENT_ACTIVATED')).toHaveLength(1)
})
it('distinguishes requested, broadcast and chain-confirmed receipts', async () => {
  const withdrawal = await reserveWithdrawalRequest({
    userId: ownerId,
    amount: '100',
    destinationAddress: '0xdestination',
    network: 'BEP20',
    feePercent: '5',
  })
  expect((await mail('WITHDRAWAL_REQUESTED'))[0].textBody).toContain(
    'no payment has been sent',
  )
  await state.db
    .update(schema.withdrawals)
    .set({ status: 'PROCESSING' })
    .where(eq(schema.withdrawals.id, withdrawal.id))
  await broadcastWithdrawal(withdrawal.id, '0xwithdrawreceipt', adminId)
  expect((await mail('WITHDRAWAL_BROADCAST'))[0].textBody).toContain(
    'not yet a confirmed payment',
  )
  await settleBroadcastWithdrawal(withdrawal.id, true)
  expect(await mail('WITHDRAWAL_CONFIRMED')).toHaveLength(1)
  await expect(settleBroadcastWithdrawal(withdrawal.id, true)).rejects.toThrow(
    'not found',
  )
  expect(await mail('WITHDRAWAL_CONFIRMED')).toHaveLength(1)
})
it('restores funds before issuing failure/rejection/cancellation receipts', async () => {
  for (const status of ['REJECTED', 'CANCELLED'] as const) {
    const row = await reserveWithdrawalRequest({
      userId: ownerId,
      amount: '10',
      destinationAddress: '0xdestination',
      network: 'BEP20',
      feePercent: '5',
    })
    await releaseApprovedWithdrawal(
      row.id,
      adminId,
      'Operator decision',
      status,
    )
    expect((await mail(`WITHDRAWAL_${status}`))[0].textBody).toContain(
      'restored',
    )
  }
  const row = await reserveWithdrawalRequest({
    userId: ownerId,
    amount: '10',
    destinationAddress: '0xdestination',
    network: 'BEP20',
    feePercent: '5',
  })
  await state.db
    .update(schema.withdrawals)
    .set({ status: 'PROCESSING' })
    .where(eq(schema.withdrawals.id, row.id))
  await broadcastWithdrawal(row.id, '0xrevertedreceipt', adminId)
  await settleBroadcastWithdrawal(row.id, false)
  expect((await mail('WITHDRAWAL_FAILED'))[0].textBody).toContain('reverted')
})
it('welcomes only after verification and rejects reused verification links', async () => {
  await register({
    data: {
      email: 'new@test.invalid',
      displayName: 'New User',
      password: 'NewPassword123!',
    },
  })
  expect(await mail('WELCOME')).toHaveLength(0)
  const [verification] = await mail('EMAIL_VERIFICATION')
  const token = new URL(
    verification.textBody.match(/https:\/\/\S+/)![0],
  ).searchParams.get('token')!
  await verifyEmail({ data: { token } })
  expect(await mail('WELCOME')).toHaveLength(1)
  await expect(verifyEmail({ data: { token } })).rejects.toThrow(
    'invalid or expired',
  )
  expect(await mail('WELCOME')).toHaveLength(1)
})
it('reset uses configured expiry and canonical domain; one-time reset revokes sessions and permits new login', async () => {
  await requestPasswordReset({ data: { email: 'owner@test.invalid' } })
  await requestPasswordReset({ data: { email: 'owner@test.invalid' } })
  const rows = await mail('PASSWORD_RESET')
  expect(rows).toHaveLength(1)
  expect(rows[0].htmlBody).toContain('45 minutes')
  expect(rows[0].htmlBody).toContain('If you did not request')
  const token = new URL(
    rows[0].textBody.match(/https:\/\/\S+/)![0],
  ).searchParams.get('token')!
  await state.db.insert(schema.sessions).values({
    userId: ownerId,
    tokenHash: 'test-session',
    expiresAt: new Date(Date.now() + 100000),
  })
  await resetPassword({
    data: {
      token,
      password: 'ResetPassword123!',
      confirmPassword: 'ResetPassword123!',
    },
  })
  expect(
    await state.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, ownerId)),
  ).toHaveLength(0)
  expect(await mail('PASSWORD_CHANGED')).toHaveLength(1)
  await expect(
    resetPassword({
      data: {
        token,
        password: 'AgainPassword123!',
        confirmPassword: 'AgainPassword123!',
      },
    }),
  ).rejects.toThrow('invalid or expired')
  await login({
    data: { email: 'owner@test.invalid', password: 'ResetPassword123!' },
  })
  await expect(
    login({ data: { email: 'owner@test.invalid', password: 'Original123!' } }),
  ).rejects.toThrow('Invalid')
})
it('profile change alerts, invalidates pending reset tokens and never emails a rejected change', async () => {
  state.user = { id: ownerId }
  const token = createEmailToken()
  await state.db.insert(schema.passwordResetTokens).values({
    userId: ownerId,
    tokenHash: token.hash,
    expiresAt: new Date(Date.now() + 100000),
  })
  await expect(
    changePassword({
      data: {
        currentPassword: 'WrongPassword123!',
        newPassword: 'ProfilePassword123!',
        confirmPassword: 'ProfilePassword123!',
      },
    }),
  ).rejects.toThrow('incorrect')
  expect(await mail('PASSWORD_CHANGED')).toHaveLength(1)
  await changePassword({
    data: {
      currentPassword: 'ResetPassword123!',
      newPassword: 'ProfilePassword123!',
      confirmPassword: 'ProfilePassword123!',
    },
  })
  expect(await mail('PASSWORD_CHANGED')).toHaveLength(2)
  await expect(
    resetPassword({
      data: {
        token: token.token,
        password: 'AgainPassword123!',
        confirmPassword: 'AgainPassword123!',
      },
    }),
  ).rejects.toThrow('invalid or expired')
  const [user] = await state.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, ownerId))
  expect(await verifyPassword('ProfilePassword123!', user.passwordHash)).toBe(
    true,
  )
})
it('disabled delivery does not accumulate receipts or backfill when reenabled', async () => {
  await state.db.update(schema.emailSettings).set({ enabled: false })
  await state.db.transaction((tx) =>
    queueUserReceipt(tx as never, {
      userId: ownerId,
      eventKey: 'disabled',
      category: 'DISABLED_TEST',
      title: 'Disabled',
      message: 'Test',
    }),
  )
  expect(await mail('DISABLED_TEST')).toHaveLength(0)
  await state.db.update(schema.emailSettings).set({ enabled: true })
})
it('provider retries and interrupted claims reuse the same idempotency key', async () => {
  await state.db.update(schema.emailOutbox).set({ status: 'SENT' })
  await state.db.transaction((tx) =>
    queueUserReceipt(tx as never, {
      userId: ownerId,
      eventKey: 'retry-test',
      category: 'RETRY_TEST',
      title: 'Retry',
      message: 'Test',
    }),
  )
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error('Timeout after acceptance'))
    .mockResolvedValue(
      new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 }),
    )
  vi.stubGlobal('fetch', fetchMock)
  expect((await processEmailOutbox()).failed).toBe(1)
  await state.db
    .update(schema.emailOutbox)
    .set({ status: 'PROCESSING', updatedAt: new Date(Date.now() - 6 * 60000) })
    .where(eq(schema.emailOutbox.category, 'RETRY_TEST'))
  expect((await processEmailOutbox()).sent).toBe(1)
  expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe(
    fetchMock.mock.calls[1][1].headers['Idempotency-Key'],
  )
  expect((await mail('RETRY_TEST'))[0].status).toBe('SENT')
})
