import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '#/db/schema'

import {
  createCommunityGroup,
  getCommunity,
  getCommunityRoom,
  joinCommunity,
  moderateCommunity,
  reactToCommunityMessage,
  reportCommunityMessage,
  sendCommunityMessage,
} from './community.functions'
import { getCommunityImageResponse } from './community-image.service'
import { listUsers } from './admin-users.functions'
import { getAdminWithdrawals } from './custody.functions'

const state = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle<typeof schema>>,
  user: null as {
    id: string
    role: 'USER' | 'MANAGER' | 'ADMIN'
    status: 'ACTIVE'
    email: string
    displayName: string
    createdAt: Date
  } | null,
}))
vi.mock('#/db', () => ({ getDb: () => state.db }))
vi.mock('./session', () => ({
  getSessionUser: () => Promise.resolve(state.user),
}))
// Keep actual handlers and validators; substitute only the HTTP transport wrapper.
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
const adminId = randomUUID()
const memberId = randomUUID()
const managerId = randomUUID()
const loungeId = 'b8c5ee12-b27f-4aef-9011-000000000002'
const announcementsId = 'b8c5ee12-b27f-4aef-9011-000000000001'
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII='
function signIn(id: string, role: 'USER' | 'MANAGER' | 'ADMIN') {
  state.user = {
    id,
    role,
    status: 'ACTIVE',
    email: `${id}@test.invalid`,
    displayName: role,
    createdAt: new Date(),
  }
}

beforeAll(async () => {
  for (const file of readdirSync('drizzle')
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, 'utf8'))
  state.db = drizzle(pg, { schema })
  await state.db.insert(schema.users).values(
    [
      { id: adminId, role: 'ADMIN' as const },
      { id: memberId, role: 'USER' as const },
      { id: managerId, role: 'MANAGER' as const },
    ].map((user) => ({
      ...user,
      status: 'ACTIVE' as const,
      email: `${user.id}@test.invalid`,
      passwordHash: 'unused-test-hash',
      displayName: user.role,
    })),
  )
}, 30000)
afterAll(async () => {
  await pg.close()
})

describe('community PostgreSQL handlers', () => {
  it('requires membership, restricts announcements, retries once, moderates and hides protected images', async () => {
    signIn(memberId, 'USER')
    expect((await getCommunity()).groups).toHaveLength(3)
    const requestId = randomUUID()
    await expect(
      sendCommunityMessage({
        data: {
          groupId: loungeId,
          requestId,
          body: 'Hello community',
          imageData: png,
        },
      }),
    ).rejects.toThrow('Join the room')
    await joinCommunity({ data: { groupId: loungeId } })
    await sendCommunityMessage({
      data: {
        groupId: loungeId,
        requestId,
        body: 'Hello community',
        imageData: png,
      },
    })
    await sendCommunityMessage({
      data: {
        groupId: loungeId,
        requestId,
        body: 'Hello community',
        imageData: png,
      },
    })
    expect(
      (await getCommunityRoom({ data: { groupId: loungeId } })).messages,
    ).toHaveLength(1)
    expect(
      (await getCommunityRoom({ data: { groupId: loungeId } })).messages[0]
        .hasImage,
    ).toBe(true)
    expect((await getCommunityImageResponse(requestId)).status).toBe(200)
    await expect(
      sendCommunityMessage({
        data: { groupId: loungeId, requestId: randomUUID(), body: 'Too fast' },
      }),
    ).rejects.toThrow('Wait a few seconds')
    await joinCommunity({ data: { groupId: announcementsId } })
    await expect(
      sendCommunityMessage({
        data: {
          groupId: announcementsId,
          requestId: randomUUID(),
          body: 'Unofficial',
        },
      }),
    ).rejects.toThrow('Only room moderators')
    await expect(
      moderateCommunity({
        data: { groupId: loungeId, targetId: requestId, action: 'PIN' },
      }),
    ).rejects.toThrow('moderator access')
    signIn(managerId, 'MANAGER')
    await expect(
      moderateCommunity({
        data: { groupId: loungeId, targetId: requestId, action: 'PIN' },
      }),
    ).rejects.toThrow('moderator access')
    await reportCommunityMessage({
      data: { messageId: requestId, reason: 'Review this attachment' },
    })
    signIn(adminId, 'ADMIN')
    await moderateCommunity({
      data: { groupId: loungeId, targetId: requestId, action: 'PIN' },
    })
    let room = await getCommunityRoom({ data: { groupId: loungeId } })
    expect(room.pinned).toHaveLength(1)
    expect(room.reports).toHaveLength(1)
    await moderateCommunity({
      data: { groupId: loungeId, targetId: requestId, action: 'HIDE' },
    })
    room = await getCommunityRoom({ data: { groupId: loungeId } })
    expect(room.messages).toHaveLength(0)
    expect(room.reports).toHaveLength(0)
    expect((await getCommunityImageResponse(requestId)).status).toBe(404)
    expect(await state.db.select().from(schema.communityMessages)).toHaveLength(
      1,
    )
    await moderateCommunity({
      data: { groupId: loungeId, targetId: memberId, action: 'MUTE' },
    })
    signIn(memberId, 'USER')
    await expect(
      sendCommunityMessage({
        data: { groupId: loungeId, requestId: randomUUID(), body: 'Muted' },
      }),
    ).rejects.toThrow('muted')
    signIn(adminId, 'ADMIN')
    await joinCommunity({ data: { groupId: announcementsId } })
    await sendCommunityMessage({
      data: {
        groupId: announcementsId,
        requestId: randomUUID(),
        body: 'Official update',
      },
    })
    expect(await state.db.select().from(schema.notifications)).toHaveLength(2)
    state.user = null
    expect((await getCommunityImageResponse(requestId)).status).toBe(401)
    await expect(getCommunity()).rejects.toThrow('Authentication required')
  })

  it('assigns manager moderation to a specific room and validates reply targets', async () => {
    signIn(adminId, 'ADMIN')
    const group = await createCommunityGroup({
      data: {
        name: 'Managed room',
        description: 'Assigned manager only',
        announcementsOnly: true,
        managerUserId: managerId,
      },
    })
    signIn(managerId, 'MANAGER')
    await joinCommunity({ data: { groupId: group.id } })
    expect(
      (await getCommunity()).groups.find((item) => item.id === group.id)
        ?.canModerate,
    ).toBe(true)
    const requestId = randomUUID()
    await sendCommunityMessage({
      data: { groupId: group.id, requestId, body: 'Manager announcement' },
    })
    await moderateCommunity({
      data: { groupId: group.id, targetId: requestId, action: 'PIN' },
    })
    signIn(adminId, 'ADMIN')
    await joinCommunity({ data: { groupId: loungeId } })
    await pg.query(
      "update community_messages set created_at = now() - interval '10 seconds'",
    )
    await expect(
      sendCommunityMessage({
        data: {
          groupId: loungeId,
          requestId: randomUUID(),
          body: 'Wrong-room reply',
          replyToId: requestId,
        },
      }),
    ).rejects.toThrow('Reply target')
    const ids = Array.from({ length: 45 }, () => randomUUID())
    await state.db.insert(schema.communityMessages).values(
      ids.map((id) => ({
        id,
        groupId: loungeId,
        authorUserId: adminId,
        body: id,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })),
    )
    const first = await getCommunityRoom({ data: { groupId: loungeId } })
    const second = await getCommunityRoom({
      data: { groupId: loungeId, before: first.olderCursor! },
    })
    expect(first.messages).toHaveLength(40)
    expect(second.messages).toHaveLength(5)
    expect(
      new Set([...first.messages, ...second.messages].map((item) => item.id))
        .size,
    ).toBe(45)
    await reactToCommunityMessage({
      data: { messageId: ids[0], emoji: '👍', active: true },
    })
    await reactToCommunityMessage({
      data: { messageId: ids[0], emoji: '👍', active: true },
    })
    expect(
      await state.db.select().from(schema.communityReactions),
    ).toHaveLength(1)
  })
})

describe('admin current balances', () => {
  it('uses ledger funds plus reserved withdrawals without double-counting investment exits or history', async () => {
    const transactionId = randomUUID()
    const availableId = randomUUID()
    const investedId = randomUUID()
    const investmentId = randomUUID()
    await state.db.insert(schema.ledgerAccounts).values(
      [
        {
          id: availableId,
          code: `USER:${memberId}:AVAILABLE`,
          name: 'Available',
        },
        { id: investedId, code: `USER:${memberId}:INVESTED`, name: 'Invested' },
      ].map((account) => ({
        ...account,
        type: 'LIABILITY' as const,
        normalBalance: 'CREDIT' as const,
        ownerUserId: memberId,
      })),
    )
    await state.db.insert(schema.ledgerTransactions).values({
      id: transactionId,
      eventType: 'TEST',
      referenceType: 'test',
      idempotencyKey: transactionId,
      description: 'Balance fixture',
      effectiveAt: new Date(),
    })
    await state.db.insert(schema.ledgerEntries).values([
      {
        transactionId,
        lineNumber: 1,
        accountId: availableId,
        credit: '200.125',
      },
      {
        transactionId,
        lineNumber: 2,
        accountId: investedId,
        credit: '500.125',
      },
    ])
    await state.db.insert(schema.investments).values({
      id: investmentId,
      userId: memberId,
      principal: '400',
      compoundedBalance: '500.125',
      activatedAt: new Date(),
    })
    await state.db
      .insert(schema.investmentExitRequests)
      .values({ investmentId, userId: memberId })
    await state.db.insert(schema.withdrawals).values([
      {
        userId: memberId,
        amount: '100.125',
        netAmount: '95',
        destinationAddress: 'test-address',
        status: 'REQUESTED' as const,
      },
      {
        userId: memberId,
        amount: '900',
        netAmount: '850',
        destinationAddress: 'test-address',
        status: 'CONFIRMED' as const,
      },
    ])
    signIn(memberId, 'USER')
    await expect(listUsers()).rejects.toThrow('Administrator access required')
    signIn(adminId, 'ADMIN')
    const user = (await listUsers()).find((item) => item.id === memberId)!
    expect(user.availableBalance).toBe('200.12500000')
    expect(user.investedBalance).toBe('500.12500000')
    expect(user.pendingWithdrawalAmount).toBe('100.12500000')
    expect(user.pendingWithdrawalNet).toBe('95.00000000')
    expect(user.pendingExitAmount).toBe('500.12500000')
    expect(user.totalBalance).toBe('800.38')
    expect(user.confirmedWithdrawals).toBe('900.00000000')
    const request = (await getAdminWithdrawals()).withdrawals.find(
      (row) => row.status === 'REQUESTED',
    )!
    expect(request.userBalance.total).toBe(user.totalBalance)
    expect(request.userBalance.reserved).toBe('100.13')
  })
})
