import { describe, expect, it } from 'vitest'

import { ProcessB3PositionDispatch } from '../src/modules/b3/application/process-b3-position-dispatch.js'
import { RunDailyB3PositionSync } from '../src/modules/b3/application/run-daily-b3-position-sync.js'
import { SyncB3InvestorPositions } from '../src/modules/b3/application/sync-b3-investor-positions.js'
import { InMemoryB3SystemClient } from '../src/modules/b3/infrastructure/b3-system-client.js'
import { hashPassword } from '../src/shared/crypto/security.js'
import {
  InMemoryB3ConnectionRepository,
  InMemoryUserRepository,
} from '../src/shared/database/memory-repositories.js'
import { InMemoryPositionSyncStore } from '../src/shared/database/position-sync-store.js'
import { testConfig } from './app.test.js'

const userId = '11111111-1111-1111-1111-111111111111'
const cpf = '33433637822'
const now = new Date('2026-07-15T02:05:00.000Z')

async function createHarness() {
  const users = new InMemoryUserRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const store = new InMemoryPositionSyncStore()
  const systemClient = new InMemoryB3SystemClient('2026-07-14')

  users.seed({
    id: userId,
    email: 'cliente@pico.test',
    passwordHash: await hashPassword('password123'),
    cpf,
    isActive: true,
  })
  connections.seed({
    id: '22222222-2222-2222-2222-222222222222',
    userId,
    status: 'AUTHORIZED',
    latestAttemptId: null,
    authorizationRequestedAt: now,
    authorizedAt: now,
    revokedAt: null,
    lastCheckedAt: now,
  })

  const requestSync = new SyncB3InvestorPositions(
    users,
    connections,
    store,
    systemClient,
    testConfig.b3,
  )
  const daily = new RunDailyB3PositionSync(systemClient, store, testConfig.b3)
  const processDispatch = new ProcessB3PositionDispatch(
    connections,
    store,
    requestSync,
    testConfig.b3,
  )

  return {
    users,
    connections,
    daily,
    processDispatch,
    store,
    systemClient,
  }
}

describe('RunDailyB3PositionSync', () => {
  it('gates the queue on B3 last-load-update', async () => {
    const { daily, store } = await createHarness()

    const result = await daily.execute({
      requestId: 'req_daily',
      now,
    })

    expect(result).toEqual({
      lastLoadedDate: '2026-07-14',
      dispatchId: expect.any(String),
      status: 'PENDING',
      reused: false,
    })
    expect(store.dispatchRows[0]).toMatchObject({
      status: 'PENDING',
      referenceDate: '2026-07-14',
    })
    expect(store.runs).toHaveLength(0)
  })

  it('reuses the same loaded reference dispatch', async () => {
    const { daily, store } = await createHarness()
    const first = await daily.execute({ requestId: 'req_day_1', now })
    const dispatch = store.dispatchRows[0]
    if (!dispatch) {
      throw new Error('expected queued dispatch')
    }
    const leaseToken = 'dispatch-test-lease'
    await store.dispatches.claim({
      environment: 'certification',
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      now,
    })
    await store.dispatches.advance({
      id: dispatch.id,
      leaseToken,
      expectedCursorUserId: null,
      cursorUserId: null,
      completed: true,
      now,
    })

    const nextDay = new Date('2026-07-16T02:05:00.000Z')
    const result = await daily.execute({
      requestId: 'req_day_2',
      now: nextDay,
    })

    expect(result.reused).toBe(true)
    expect(result.dispatchId).toBe(first.dispatchId)
    expect(result.status).toBe('SUCCEEDED')
    expect(store.dispatchRows).toHaveLength(1)
  })

  it('leases a dispatch so overlapping workers cannot move its cursor', async () => {
    const { daily, store } = await createHarness()
    await daily.execute({ requestId: 'req_lease', now })
    const first = await store.dispatches.claim({
      environment: 'certification',
      leaseToken: 'lease-one',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      now,
    })
    const overlapping = await store.dispatches.claim({
      environment: 'certification',
      leaseToken: 'lease-two',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      now,
    })

    expect(first?.status).toBe('RUNNING')
    expect(overlapping).toBeNull()
    await expect(
      store.dispatches.advance({
        id: first?.id ?? '',
        leaseToken: 'lease-two',
        expectedCursorUserId: null,
        cursorUserId: userId,
        completed: false,
        now,
      }),
    ).rejects.toThrow('Pending B3 position dispatch not found')
  })

  it('supersedes an unfinished older-reference dispatch', async () => {
    const { daily, store } = await createHarness()
    await daily.execute({ requestId: 'req_old_reference', now })
    const newerDaily = new RunDailyB3PositionSync(
      new InMemoryB3SystemClient('2026-07-15'),
      store,
      testConfig.b3,
    )

    const newer = await newerDaily.execute({
      requestId: 'req_new_reference',
      now: new Date('2026-07-16T02:05:00.000Z'),
    })

    expect(newer.reused).toBe(false)
    expect(store.dispatchRows).toHaveLength(2)
    expect(store.dispatchRows[0]?.status).toBe('SUPERSEDED')
    expect(store.dispatchRows[1]?.status).toBe('PENDING')
  })

  it('fans out authorized users with a durable cursor checkpoint', async () => {
    const { users, connections, daily, processDispatch, store } =
      await createHarness()
    const additionalUsers = [
      {
        id: '33333333-3333-3333-3333-333333333333',
        email: 'dois@pico.test',
        cpf: '39053344705',
      },
      {
        id: '55555555-5555-5555-5555-555555555555',
        email: 'tres@pico.test',
        cpf: '52998224725',
      },
    ]
    for (const [index, user] of additionalUsers.entries()) {
      users.seed({
        ...user,
        passwordHash: await hashPassword('password123'),
        isActive: true,
      })
      connections.seed({
        id:
          index === 0
            ? '44444444-4444-4444-4444-444444444444'
            : '66666666-6666-6666-6666-666666666666',
        userId: user.id,
        status: 'AUTHORIZED',
        latestAttemptId: null,
        authorizationRequestedAt: now,
        authorizedAt: now,
        revokedAt: null,
        lastCheckedAt: now,
      })
    }
    await daily.execute({ requestId: 'req_dispatch', now })

    const firstPage = await processDispatch.execute({
      requestId: 'worker_dispatch_1',
      pageSize: 2,
      now,
    })
    const secondPage = await processDispatch.execute({
      requestId: 'worker_dispatch_2',
      pageSize: 2,
      now,
    })

    expect(firstPage).toMatchObject({ scanned: 2, completed: false })
    expect(secondPage).toMatchObject({ scanned: 1, completed: true })
    expect(store.runs).toHaveLength(3)
    expect(store.dispatchRows[0]?.status).toBe('SUCCEEDED')
  })

  it('fails closed when B3 last-load-update is unavailable', async () => {
    const { store } = await createHarness()
    const unavailable = {
      getLastLoadedDate: async () => {
        throw new Error('B3 unavailable')
      },
    }
    const daily = new RunDailyB3PositionSync(
      unavailable,
      store,
      testConfig.b3,
    )

    await expect(
      daily.execute({ requestId: 'req_unavailable', now }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'B3_LAST_LOAD_UNAVAILABLE',
    })
  })
})
