import { describe, expect, it, vi } from 'vitest'

import { ListPortfolioPositions } from '../src/modules/b3/application/list-portfolio-positions.js'
import { ProcessB3InvestorPositions } from '../src/modules/b3/application/process-b3-investor-positions.js'
import { ProcessB3PositionDispatch } from '../src/modules/b3/application/process-b3-position-dispatch.js'
import { ProcessPendingB3PositionSyncs } from '../src/modules/b3/application/process-pending-b3-position-syncs.js'
import { SyncB3InvestorPositions } from '../src/modules/b3/application/sync-b3-investor-positions.js'
import { hashPositionNaturalKey } from '../src/modules/b3/domain/position-dates.js'
import { InMemoryB3PositionClient } from '../src/modules/b3/infrastructure/b3-position-client.js'
import { InMemoryB3SystemClient } from '../src/modules/b3/infrastructure/b3-system-client.js'
import { hashPassword, hashSha256 } from '../src/shared/crypto/security.js'
import {
  InMemoryB3ConnectionRepository,
  InMemoryUserRepository,
} from '../src/shared/database/memory-repositories.js'
import { InMemoryPositionSyncStore } from '../src/shared/database/position-sync-store.js'
import { testConfig } from './app.test.js'

const now = new Date('2026-07-10T15:00:00.000Z')
const userId = '11111111-1111-1111-1111-111111111111'
const cpf = '33433637822'

async function createHarness(options?: { failFetch?: boolean }) {
  const users = new InMemoryUserRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const store = new InMemoryPositionSyncStore()
  const positionClient = new InMemoryB3PositionClient()

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

  const item = { tickerSymbol: 'PETR4', quantity: 10 }
  positionClient.seed(cpf, [
    {
      product: 'equities',
      naturalKeyHash: hashPositionNaturalKey({
        documentNumber: cpf,
        product: 'equities',
        referenceDate: '2026-07-09',
        item,
      }),
      instrumentCode: 'PETR4',
      quantity: '10',
      rawPayload: item,
    },
  ])
  if (options?.failFetch) {
    positionClient.failWith = new Error('B3 down')
  }

  const systemClient = new InMemoryB3SystemClient('2026-07-09')
  const requestSync = new SyncB3InvestorPositions(
    users,
    connections,
    store,
    systemClient,
    testConfig.b3,
  )
  const processSync = new ProcessB3InvestorPositions(
    users,
    connections,
    store,
    positionClient,
    testConfig.b3,
  )
  const processDispatch = new ProcessB3PositionDispatch(
    connections,
    store,
    requestSync,
    testConfig.b3,
  )
  const worker = new ProcessPendingB3PositionSyncs(
    store,
    processDispatch,
    processSync,
    testConfig.b3,
  )

  return {
    users,
    connections,
    store,
    systemClient,
    positionClient,
    requestSync,
    processSync,
    worker,
    list: new ListPortfolioPositions(store, testConfig.b3),
  }
}

describe('B3 position synchronization queue', () => {
  it('returns PENDING immediately and lets the worker persist atomically', async () => {
    const { store, requestSync, worker, list } = await createHarness()

    const requested = await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_sync_1',
      now,
    })

    expect(requested).toMatchObject({
      status: 'PENDING',
      reused: false,
      positionCount: 0,
      businessDay: '2026-07-10',
      referenceDate: '2026-07-09',
    })
    expect((await list.execute({ userId })).positions).toHaveLength(0)

    const processed = await worker.execute({
      requestId: 'req_worker_1',
      now,
    })

    expect(processed).toMatchObject({
      claimed: 1,
      results: [{ status: 'SUCCEEDED', errorCode: null }],
    })
    expect((await list.execute({ userId })).positions[0]?.instrumentCode).toBe(
      'PETR4',
    )
    expect(store.audit.events.map((event) => event.action)).toEqual([
      'B3_POSITION_SYNC_REQUESTED',
      'B3_POSITION_SYNC_SUCCEEDED',
    ])
    expect(JSON.stringify(store.audit.events)).not.toContain(cpf)
  })

  it('preserves the previous portfolio and consumes the day on B3 failure', async () => {
    const { store, requestSync, worker, list } = await createHarness({
      failFetch: true,
    })
    store.positionRows.push({
      id: '33333333-3333-3333-3333-333333333333',
      userId,
      environment: 'certification',
      syncRunId: '44444444-4444-4444-4444-444444444444',
      referenceDate: '2026-07-08',
      product: 'equities',
      naturalKeyHash: 'old-key',
      instrumentCode: 'VALE3',
      quantity: '5',
      rawPayload: { tickerSymbol: 'VALE3' },
      isCurrent: true,
      supersededAt: null,
      sourceSyncedAt: now,
    })

    await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_sync_fail',
      now,
    })
    const processed = await worker.execute({
      requestId: 'req_worker_fail',
      now,
    })

    expect(processed.results[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'B3_POSITION_FETCH_FAILED',
    })
    expect((await list.execute({ userId })).positions[0]?.instrumentCode).toBe(
      'VALE3',
    )

    const reused = await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_sync_retry',
      now,
    })
    expect(reused).toMatchObject({ reused: true, status: 'FAILED' })
  })

  it('enforces unique CPF ownership before applying the daily CPF cap', async () => {
    const { users, store, requestSync } = await createHarness()
    await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_first_account',
      now,
    })

    const secondUserId = '55555555-5555-5555-5555-555555555555'
    expect(() =>
      users.seed({
        id: secondUserId,
        email: 'segunda-conta@pico.test',
        passwordHash: 'unused-in-duplicate-check',
        cpf,
        isActive: true,
      }),
    ).toThrow(/duplicate user CPF/)
    expect(store.runs).toHaveLength(1)
  })

  it('rolls back portfolio writes and marks persistence failures', async () => {
    const { store, requestSync, worker, list } = await createHarness()
    store.positionRows.push({
      id: '77777777-7777-7777-7777-777777777777',
      userId,
      environment: 'certification',
      syncRunId: '88888888-8888-8888-8888-888888888888',
      referenceDate: '2026-07-08',
      product: 'equities',
      naturalKeyHash: 'previous-position',
      instrumentCode: 'VALE3',
      quantity: '5',
      rawPayload: { tickerSymbol: 'VALE3' },
      isCurrent: true,
      supersededAt: null,
      sourceSyncedAt: now,
    })
    const replace = store.positions.replaceForUserEnvironment.bind(
      store.positions,
    )
    vi.spyOn(store.positions, 'replaceForUserEnvironment').mockImplementation(
      async (input) => {
        await replace(input)
        throw new Error('database write failed')
      },
    )

    await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_persistence_failure',
      now,
    })
    const processed = await worker.execute({
      requestId: 'req_worker_persistence',
      now,
    })

    expect(processed.results[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'POSITION_PERSISTENCE_FAILED',
    })
    expect((await list.execute({ userId })).positions[0]?.instrumentCode).toBe(
      'VALE3',
    )
  })

  it('recovers stale RUNNING executions without retrying B3', async () => {
    const { store, worker } = await createHarness()
    const staleTime = new Date(now.getTime() - 61 * 60 * 1000)
    await store.syncRuns.createPending({
      userId,
      documentHash: hashSha256(cpf),
      environment: 'certification',
      trigger: 'MANUAL',
      requestId: 'req_stale_original',
      businessDay: '2026-07-10',
      referenceDate: '2026-07-09',
      now: staleTime,
    })
    await store.syncRuns.claimPending({
      environment: 'certification',
      limit: 1,
      now: staleTime,
    })

    const result = await worker.execute({
      requestId: 'req_stale_recovery_worker',
      now,
    })

    expect(result).toMatchObject({ recoveredStale: 1, claimed: 0 })
    expect(store.runs[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'STALE_SYNC_RUN',
    })
  })

  it('claims at most one running position snapshot per CPF', async () => {
    const { store } = await createHarness()
    for (const [businessDay, referenceDate] of [
      ['2026-07-10', '2026-07-09'],
      ['2026-07-11', '2026-07-10'],
    ] as const) {
      await store.syncRuns.createPending({
        userId,
        documentHash: hashSha256(cpf),
        environment: 'certification',
        trigger: 'CRON',
        requestId: `req_${businessDay}`,
        businessDay,
        referenceDate,
        now,
      })
    }

    const claimed = await store.syncRuns.claimPending({
      environment: 'certification',
      limit: 2,
      now,
    })

    expect(claimed).toHaveLength(1)
    expect(claimed[0]?.referenceDate).toBe('2026-07-09')
  })

  it('uses compare-and-set terminal transitions to prevent stale races', async () => {
    const { store, requestSync } = await createHarness()
    const requested = await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_race',
      now,
    })
    await store.syncRuns.claimPending({
      environment: 'certification',
      limit: 1,
      now,
    })
    await store.syncRuns.markSucceeded({ id: requested.syncRunId, now })

    await expect(
      store.syncRuns.markFailed({
        id: requested.syncRunId,
        now,
        errorCode: 'STALE_SYNC_RUN',
        errorMessage: 'stale worker',
      }),
    ).rejects.toThrow(/running sync run not found/)
    expect(await store.syncRuns.findById(requested.syncRunId)).toMatchObject({
      status: 'SUCCEEDED',
      errorCode: null,
    })
  })

  it('supersedes positions without deleting financial history', async () => {
    const { store, systemClient, requestSync, worker } = await createHarness()
    await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_history_day_1',
      now,
    })
    await worker.execute({ requestId: 'worker_history_day_1', now })

    const nextDay = new Date('2026-07-13T15:00:00.000Z')
    systemClient.setLastLoadedDate('2026-07-10')
    await requestSync.execute({
      userId,
      trigger: 'MANUAL',
      requestId: 'req_history_day_2',
      now: nextDay,
    })
    await worker.execute({
      requestId: 'worker_history_day_2',
      now: nextDay,
    })

    expect(store.positionRows).toHaveLength(2)
    expect(store.positionRows.filter((position) => position.isCurrent)).toHaveLength(
      1,
    )
    expect(
      store.positionRows.filter((position) => !position.isCurrent)[0],
    ).toMatchObject({ supersededAt: nextDay })
  })

  it('paginates the current portfolio with an opaque cursor', async () => {
    const { store, list } = await createHarness()
    for (const [id, instrumentCode] of [
      ['10000000-0000-4000-8000-000000000000', 'PETR4'],
      ['20000000-0000-4000-8000-000000000000', 'VALE3'],
    ] as const) {
      store.positionRows.push({
        id,
        userId,
        environment: 'certification',
        syncRunId: '99999999-9999-4999-8999-999999999999',
        referenceDate: '2026-07-09',
        product: 'equities',
        naturalKeyHash: instrumentCode,
        instrumentCode,
        quantity: '1',
        rawPayload: { tickerSymbol: instrumentCode, quantity: 1 },
        isCurrent: true,
        supersededAt: null,
        sourceSyncedAt: now,
      })
    }

    const first = await list.execute({ userId, limit: 1 })
    const second = await list.execute({
      userId,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
      limit: 1,
    })

    expect(first.positions[0]?.instrumentCode).toBe('PETR4')
    expect(first.nextCursor).toBe('10000000-0000-4000-8000-000000000000')
    expect(second.positions[0]?.instrumentCode).toBe('VALE3')
    expect(second.nextCursor).toBeNull()
  })
})
