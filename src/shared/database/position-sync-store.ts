import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
} from 'drizzle-orm'

import type { Database, DbExecutor } from './client.js'
import {
  b3PositionDispatches,
  b3SyncRuns,
  portfolioPositions,
} from './schema/index.js'
import type {
  B3PositionDispatchRecord,
  B3SyncRunRecord,
  B3SyncTrigger,
  PortfolioPositionInput,
  PortfolioPositionRecord,
} from '../../modules/b3/domain/position-types.js'
import type {
  AuditRepository,
} from '../../modules/b3/domain/b3-repositories.js'
import type {
  B3PositionDispatchRepository,
  B3SyncRunRepository,
  PortfolioPositionRepository,
  PositionSyncRepos,
  PositionSyncStore,
} from '../../modules/b3/domain/position-sync-repositories.js'
import { DrizzleAuditRepository } from './drizzle-repositories.js'
import { InMemoryAuditRepository } from './memory-repositories.js'

function mapSyncRun(row: typeof b3SyncRuns.$inferSelect): B3SyncRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    documentHash: row.documentHash,
    environment: row.environment,
    kind: row.kind,
    status: row.status,
    trigger: row.trigger,
    requestId: row.requestId,
    businessDay: String(row.businessDay),
    referenceDate: String(row.referenceDate),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  }
}

function mapPosition(row: typeof portfolioPositions.$inferSelect): PortfolioPositionRecord {
  return {
    id: row.id,
    userId: row.userId,
    environment: row.environment,
    syncRunId: row.syncRunId,
    referenceDate: String(row.referenceDate),
    product: row.product,
    naturalKeyHash: row.naturalKeyHash,
    instrumentCode: row.instrumentCode,
    quantity: row.quantity,
    rawPayload: row.rawPayload,
    isCurrent: row.isCurrent,
    supersededAt: row.supersededAt,
    sourceSyncedAt: row.sourceSyncedAt,
  }
}

function mapDispatch(
  row: typeof b3PositionDispatches.$inferSelect,
): B3PositionDispatchRecord {
  return {
    id: row.id,
    environment: row.environment,
    referenceDate: String(row.referenceDate),
    businessDay: String(row.businessDay),
    status: row.status,
    cursorUserId: row.cursorUserId,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    requestId: row.requestId,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  }
}

export class DrizzleB3PositionDispatchRepository
  implements B3PositionDispatchRepository
{
  constructor(private readonly db: DbExecutor) {}

  async createOrGet(input: {
    environment: 'certification' | 'production'
    referenceDate: string
    businessDay: string
    requestId: string
    now: Date
  }): Promise<{ dispatch: B3PositionDispatchRecord; created: boolean }> {
    await this.db
      .update(b3PositionDispatches)
      .set({
        status: 'SUPERSEDED',
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(b3PositionDispatches.environment, input.environment),
          lt(b3PositionDispatches.referenceDate, input.referenceDate),
          inArray(b3PositionDispatches.status, ['PENDING', 'RUNNING']),
        ),
      )

    const [created] = await this.db
      .insert(b3PositionDispatches)
      .values({
        environment: input.environment,
        referenceDate: input.referenceDate,
        businessDay: input.businessDay,
        requestId: input.requestId,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning()

    if (created) {
      return { dispatch: mapDispatch(created), created: true }
    }

    const [existing] = await this.db
      .select()
      .from(b3PositionDispatches)
      .where(
        and(
          eq(b3PositionDispatches.environment, input.environment),
          eq(b3PositionDispatches.referenceDate, input.referenceDate),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new Error('Failed to create or find B3 position dispatch')
    }
    const canRefreshBusinessDay =
      existing.status === 'PENDING' ||
      (existing.status === 'RUNNING' &&
        (!existing.leaseExpiresAt || existing.leaseExpiresAt < input.now))
    if (
      canRefreshBusinessDay &&
      String(existing.businessDay) < input.businessDay
    ) {
      const [updated] = await this.db
        .update(b3PositionDispatches)
        .set({
          businessDay: input.businessDay,
          status: 'PENDING',
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(b3PositionDispatches.id, existing.id),
            or(
              eq(b3PositionDispatches.status, 'PENDING'),
              and(
                eq(b3PositionDispatches.status, 'RUNNING'),
                or(
                  isNull(b3PositionDispatches.leaseExpiresAt),
                  lt(b3PositionDispatches.leaseExpiresAt, input.now),
                ),
              ),
            ),
          ),
        )
        .returning()
      if (updated) {
        return { dispatch: mapDispatch(updated), created: false }
      }
    }
    return { dispatch: mapDispatch(existing), created: false }
  }

  async claim(input: {
    environment: 'certification' | 'production'
    leaseToken: string
    leaseExpiresAt: Date
    now: Date
  }): Promise<B3PositionDispatchRecord | null> {
    const available = or(
      eq(b3PositionDispatches.status, 'PENDING'),
      and(
        eq(b3PositionDispatches.status, 'RUNNING'),
        or(
          isNull(b3PositionDispatches.leaseExpiresAt),
          lt(b3PositionDispatches.leaseExpiresAt, input.now),
        ),
      ),
    )
    const [candidate] = await this.db
      .select()
      .from(b3PositionDispatches)
      .where(
        and(
          eq(b3PositionDispatches.environment, input.environment),
          available,
        ),
      )
      .orderBy(
        desc(b3PositionDispatches.referenceDate),
        asc(b3PositionDispatches.createdAt),
      )
      .limit(1)
    if (!candidate) {
      return null
    }

    const [claimed] = await this.db
      .update(b3PositionDispatches)
      .set({
        status: 'RUNNING',
        leaseToken: input.leaseToken,
        leaseExpiresAt: input.leaseExpiresAt,
        updatedAt: input.now,
      })
      .where(and(eq(b3PositionDispatches.id, candidate.id), available))
      .returning()
    return claimed ? mapDispatch(claimed) : null
  }

  async advance(input: {
    id: string
    leaseToken: string
    expectedCursorUserId: string | null
    cursorUserId: string | null
    completed: boolean
    now: Date
  }): Promise<B3PositionDispatchRecord> {
    const [row] = await this.db
      .update(b3PositionDispatches)
      .set({
        cursorUserId: input.cursorUserId,
        status: input.completed ? 'SUCCEEDED' : 'PENDING',
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: input.completed ? input.now : null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(b3PositionDispatches.id, input.id),
          eq(b3PositionDispatches.status, 'RUNNING'),
          eq(b3PositionDispatches.leaseToken, input.leaseToken),
          input.expectedCursorUserId
            ? eq(
                b3PositionDispatches.cursorUserId,
                input.expectedCursorUserId,
              )
            : isNull(b3PositionDispatches.cursorUserId),
        ),
      )
      .returning()
    if (!row) {
      throw new Error('Pending B3 position dispatch not found')
    }
    return mapDispatch(row)
  }
}

export class DrizzleB3SyncRunRepository implements B3SyncRunRepository {
  constructor(private readonly db: DbExecutor) {}

  async findByDocumentHashEnvironmentBusinessDay(input: {
    documentHash: string
    environment: 'certification' | 'production'
    businessDay: string
  }): Promise<B3SyncRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(b3SyncRuns)
      .where(
        and(
          eq(b3SyncRuns.documentHash, input.documentHash),
          eq(b3SyncRuns.environment, input.environment),
          eq(b3SyncRuns.kind, 'POSITION_D1'),
          eq(b3SyncRuns.businessDay, input.businessDay),
        ),
      )
      .limit(1)

    return row ? mapSyncRun(row) : null
  }

  async findLatestByUser(input: {
    userId: string
    environment: 'certification' | 'production'
  }): Promise<B3SyncRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(b3SyncRuns)
      .where(
        and(
          eq(b3SyncRuns.userId, input.userId),
          eq(b3SyncRuns.environment, input.environment),
        ),
      )
      .orderBy(desc(b3SyncRuns.createdAt))
      .limit(1)

    return row ? mapSyncRun(row) : null
  }

  async findLatestSucceededByDocumentHash(input: {
    documentHash: string
    environment: 'certification' | 'production'
  }): Promise<B3SyncRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(b3SyncRuns)
      .where(
        and(
          eq(b3SyncRuns.documentHash, input.documentHash),
          eq(b3SyncRuns.environment, input.environment),
          eq(b3SyncRuns.status, 'SUCCEEDED'),
        ),
      )
      .orderBy(desc(b3SyncRuns.referenceDate))
      .limit(1)

    return row ? mapSyncRun(row) : null
  }

  async findById(id: string): Promise<B3SyncRunRecord | null> {
    const [row] = await this.db
      .select()
      .from(b3SyncRuns)
      .where(eq(b3SyncRuns.id, id))
      .limit(1)

    return row ? mapSyncRun(row) : null
  }

  async findStaleRunning(input: {
    environment: 'certification' | 'production'
    startedBefore: Date
    limit: number
  }): Promise<readonly B3SyncRunRecord[]> {
    const rows = await this.db
      .select()
      .from(b3SyncRuns)
      .where(
        and(
          eq(b3SyncRuns.environment, input.environment),
          eq(b3SyncRuns.status, 'RUNNING'),
          lt(b3SyncRuns.startedAt, input.startedBefore),
        ),
      )
      .orderBy(asc(b3SyncRuns.startedAt))
      .limit(input.limit)

    return Object.freeze(rows.map(mapSyncRun))
  }

  async createPending(input: {
    userId: string
    documentHash: string
    environment: 'certification' | 'production'
    trigger: B3SyncTrigger
    requestId: string
    businessDay: string
    referenceDate: string
    now: Date
  }): Promise<B3SyncRunRecord> {
    const [row] = await this.db
      .insert(b3SyncRuns)
      .values({
        userId: input.userId,
        documentHash: input.documentHash,
        environment: input.environment,
        kind: 'POSITION_D1',
        status: 'PENDING',
        trigger: input.trigger,
        requestId: input.requestId,
        businessDay: input.businessDay,
        referenceDate: input.referenceDate,
        updatedAt: input.now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create B3 sync run')
    }

    return mapSyncRun(row)
  }

  async claimPending(input: {
    environment: 'certification' | 'production'
    limit: number
    now: Date
  }): Promise<readonly B3SyncRunRecord[]> {
    const claimed: B3SyncRunRecord[] = []
    const candidates = await this.db
      .select({ id: b3SyncRuns.id })
      .from(b3SyncRuns)
      .where(
        and(
          eq(b3SyncRuns.status, 'PENDING'),
          eq(b3SyncRuns.environment, input.environment),
        ),
      )
      .orderBy(asc(b3SyncRuns.referenceDate), asc(b3SyncRuns.createdAt))
      .limit(input.limit * 10)

    for (const candidate of candidates) {
      if (claimed.length >= input.limit) {
        break
      }
      try {
        const [row] = await this.db
          .update(b3SyncRuns)
          .set({
            status: 'RUNNING',
            startedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(b3SyncRuns.id, candidate.id),
              eq(b3SyncRuns.status, 'PENDING'),
            ),
          )
          .returning()

        if (row) {
          claimed.push(mapSyncRun(row))
        }
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === '23505'
        ) {
          continue
        }
        throw error
      }
    }

    return Object.freeze(claimed)
  }

  async markSucceeded(input: { id: string; now: Date }): Promise<B3SyncRunRecord> {
    const [row] = await this.db
      .update(b3SyncRuns)
      .set({
        status: 'SUCCEEDED',
        finishedAt: input.now,
        errorCode: null,
        errorMessage: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(b3SyncRuns.id, input.id),
          eq(b3SyncRuns.status, 'RUNNING'),
        ),
      )
      .returning()

    if (!row) {
      throw new Error('Failed to mark sync run succeeded')
    }

    return mapSyncRun(row)
  }

  async markFailed(input: {
    id: string
    now: Date
    errorCode: string
    errorMessage: string
  }): Promise<B3SyncRunRecord> {
    const [row] = await this.db
      .update(b3SyncRuns)
      .set({
        status: 'FAILED',
        finishedAt: input.now,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 2000),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(b3SyncRuns.id, input.id),
          eq(b3SyncRuns.status, 'RUNNING'),
        ),
      )
      .returning()

    if (!row) {
      throw new Error('Failed to mark sync run failed')
    }

    return mapSyncRun(row)
  }
}

export class DrizzlePortfolioPositionRepository implements PortfolioPositionRepository {
  constructor(private readonly db: DbExecutor) {}

  async replaceForUserEnvironment(input: {
    userId: string
    environment: 'certification' | 'production'
    syncRunId: string
    referenceDate: string
    positions: readonly PortfolioPositionInput[]
    now: Date
  }): Promise<readonly PortfolioPositionRecord[]> {
    await this.db
      .update(portfolioPositions)
      .set({
        isCurrent: false,
        supersededAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(portfolioPositions.userId, input.userId),
          eq(portfolioPositions.environment, input.environment),
          eq(portfolioPositions.isCurrent, true),
        ),
      )

    if (input.positions.length === 0) {
      return Object.freeze([])
    }

    const rows = await this.db
      .insert(portfolioPositions)
      .values(
        input.positions.map((position) => ({
          userId: input.userId,
          environment: input.environment,
          syncRunId: input.syncRunId,
          referenceDate: input.referenceDate,
          product: position.product,
          naturalKeyHash: position.naturalKeyHash,
          instrumentCode: position.instrumentCode,
          quantity: position.quantity,
          rawPayload: position.rawPayload,
          isCurrent: true,
          supersededAt: null,
          sourceSyncedAt: input.now,
          updatedAt: input.now,
        })),
      )
      .returning()

    return Object.freeze(rows.map(mapPosition))
  }

  async listByUser(input: {
    userId: string
    environment: 'certification' | 'production'
    cursor?: string
    limit: number
  }): Promise<readonly PortfolioPositionRecord[]> {
    const rows = await this.db
      .select()
      .from(portfolioPositions)
      .where(
        and(
          eq(portfolioPositions.userId, input.userId),
          eq(portfolioPositions.environment, input.environment),
          eq(portfolioPositions.isCurrent, true),
          input.cursor ? gt(portfolioPositions.id, input.cursor) : undefined,
        ),
      )
      .orderBy(asc(portfolioPositions.id))
      .limit(input.limit)

    return Object.freeze(rows.map(mapPosition))
  }

  async countByUser(input: {
    userId: string
    environment: 'certification' | 'production'
  }): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(portfolioPositions)
      .where(
        and(
          eq(portfolioPositions.userId, input.userId),
          eq(portfolioPositions.environment, input.environment),
          eq(portfolioPositions.isCurrent, true),
        ),
      )
    return row?.value ?? 0
  }
}

export class DrizzlePositionSyncStore implements PositionSyncStore {
  readonly dispatches: B3PositionDispatchRepository
  readonly syncRuns: B3SyncRunRepository
  readonly positions: PortfolioPositionRepository
  readonly audit: AuditRepository

  constructor(private readonly db: Database) {
    this.dispatches = new DrizzleB3PositionDispatchRepository(db)
    this.syncRuns = new DrizzleB3SyncRunRepository(db)
    this.positions = new DrizzlePortfolioPositionRepository(db)
    this.audit = new DrizzleAuditRepository(db)
  }

  async runInTransaction<T>(
    work: (repos: PositionSyncRepos) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) =>
      work({
        dispatches: new DrizzleB3PositionDispatchRepository(tx),
        syncRuns: new DrizzleB3SyncRunRepository(tx),
        positions: new DrizzlePortfolioPositionRepository(tx),
        audit: new DrizzleAuditRepository(tx),
      }),
    )
  }
}

export class InMemoryPositionSyncStore implements PositionSyncStore {
  readonly dispatchRows: B3PositionDispatchRecord[] = []
  readonly runs: B3SyncRunRecord[] = []
  readonly positionRows: PortfolioPositionRecord[] = []

  readonly dispatches: B3PositionDispatchRepository
  readonly syncRuns: B3SyncRunRepository
  readonly positions: PortfolioPositionRepository
  readonly audit: InMemoryAuditRepository

  constructor(audit: InMemoryAuditRepository = new InMemoryAuditRepository()) {
    this.audit = audit
    this.dispatches = this.createDispatchRepo()
    this.syncRuns = this.createSyncRunRepo()
    this.positions = this.createPositionRepo()
  }

  private createDispatchRepo(): B3PositionDispatchRepository {
    return {
      createOrGet: async (input) => {
        for (const dispatch of this.dispatchRows) {
          if (
            dispatch.environment === input.environment &&
            dispatch.referenceDate < input.referenceDate &&
            (dispatch.status === 'PENDING' || dispatch.status === 'RUNNING')
          ) {
            Object.assign(dispatch, {
              status: 'SUPERSEDED',
              leaseToken: null,
              leaseExpiresAt: null,
              finishedAt: input.now,
            })
          }
        }
        const existing = this.dispatchRows.find(
          (dispatch) =>
            dispatch.environment === input.environment &&
            dispatch.referenceDate === input.referenceDate,
        )
        if (existing) {
          const canRefreshBusinessDay =
            existing.status === 'PENDING' ||
            (existing.status === 'RUNNING' &&
              (!existing.leaseExpiresAt ||
                existing.leaseExpiresAt < input.now))
          if (
            canRefreshBusinessDay &&
            existing.businessDay < input.businessDay
          ) {
            Object.assign(existing, {
              businessDay: input.businessDay,
              status: 'PENDING',
              leaseToken: null,
              leaseExpiresAt: null,
            })
          }
          return { dispatch: existing, created: false }
        }
        const dispatch: B3PositionDispatchRecord = {
          id: randomUUID(),
          environment: input.environment,
          referenceDate: input.referenceDate,
          businessDay: input.businessDay,
          status: 'PENDING',
          cursorUserId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          requestId: input.requestId,
          finishedAt: null,
          createdAt: input.now,
        }
        this.dispatchRows.push(dispatch)
        return { dispatch, created: true }
      },

      claim: async (input) => {
        const dispatch =
          this.dispatchRows
          .filter(
            (dispatch) =>
                dispatch.environment === input.environment &&
                (dispatch.status === 'PENDING' ||
                  (dispatch.status === 'RUNNING' &&
                    (!dispatch.leaseExpiresAt ||
                      dispatch.leaseExpiresAt < input.now))),
          )
            .sort(
              (a, b) =>
                b.referenceDate.localeCompare(a.referenceDate) ||
                a.createdAt.getTime() - b.createdAt.getTime(),
            )[0] ?? null
        if (!dispatch) {
          return null
        }
        Object.assign(dispatch, {
          status: 'RUNNING',
          leaseToken: input.leaseToken,
          leaseExpiresAt: input.leaseExpiresAt,
        })
        return dispatch
      },

      advance: async (input) => {
        const dispatch = this.dispatchRows.find(
          (item) =>
            item.id === input.id &&
            item.status === 'RUNNING' &&
            item.leaseToken === input.leaseToken &&
            item.cursorUserId === input.expectedCursorUserId,
        )
        if (!dispatch) {
          throw new Error('Pending B3 position dispatch not found')
        }
        const updated: B3PositionDispatchRecord = {
          ...dispatch,
          cursorUserId: input.cursorUserId,
          status: input.completed ? 'SUCCEEDED' : 'PENDING',
          leaseToken: null,
          leaseExpiresAt: null,
          finishedAt: input.completed ? input.now : null,
        }
        Object.assign(dispatch, updated)
        return updated
      },
    }
  }

  private createSyncRunRepo(): B3SyncRunRepository {
    return {
      findByDocumentHashEnvironmentBusinessDay: async (input) =>
        this.runs.find(
          (run) =>
            run.documentHash === input.documentHash &&
            run.environment === input.environment &&
            run.businessDay === input.businessDay &&
            run.kind === 'POSITION_D1',
        ) ?? null,

      findLatestByUser: async (input) => {
        const matches = this.runs
          .filter(
            (run) =>
              run.userId === input.userId && run.environment === input.environment,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return matches[0] ?? null
      },

      findLatestSucceededByDocumentHash: async (input) => {
        const matches = this.runs
          .filter(
            (run) =>
              run.documentHash === input.documentHash &&
              run.environment === input.environment &&
              run.status === 'SUCCEEDED',
          )
          .sort((a, b) => b.referenceDate.localeCompare(a.referenceDate))
        return matches[0] ?? null
      },

      findById: async (id) => this.runs.find((run) => run.id === id) ?? null,

      findStaleRunning: async (input) =>
        Object.freeze(
          this.runs
            .filter(
              (run) =>
                run.environment === input.environment &&
                run.status === 'RUNNING' &&
                run.startedAt !== null &&
                run.startedAt < input.startedBefore,
            )
            .sort(
              (a, b) =>
                (a.startedAt?.getTime() ?? 0) -
                (b.startedAt?.getTime() ?? 0),
            )
            .slice(0, input.limit),
        ),

      createPending: async (input) => {
        const existing =
          await this.syncRuns.findByDocumentHashEnvironmentBusinessDay(input)
        if (existing) {
          const error = new Error('duplicate sync run') as Error & { code?: string }
          error.code = '23505'
          throw error
        }

        const run: B3SyncRunRecord = {
          id: randomUUID(),
          userId: input.userId,
          documentHash: input.documentHash,
          environment: input.environment,
          kind: 'POSITION_D1',
          status: 'PENDING',
          trigger: input.trigger,
          requestId: input.requestId,
          businessDay: input.businessDay,
          referenceDate: input.referenceDate,
          startedAt: null,
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
          createdAt: input.now,
        }
        this.runs.push(run)
        return run
      },

      claimPending: async (input) => {
        const pending = this.runs
          .filter(
            (run) =>
              run.status === 'PENDING' &&
              run.environment === input.environment,
          )
          .sort(
            (a, b) =>
              a.referenceDate.localeCompare(b.referenceDate) ||
              a.createdAt.getTime() - b.createdAt.getTime(),
          )
        const claimed: B3SyncRunRecord[] = []
        for (const run of pending) {
          if (claimed.length >= input.limit) {
            break
          }
          const isDocumentRunning = this.runs.some(
            (active) =>
              active.status === 'RUNNING' &&
              active.environment === run.environment &&
              active.documentHash === run.documentHash,
          )
          if (isDocumentRunning) {
            continue
          }
          const claimedRun: B3SyncRunRecord = {
            ...run,
            status: 'RUNNING',
            startedAt: input.now,
          }
          Object.assign(run, claimedRun)
          claimed.push(claimedRun)
        }
        return Object.freeze(claimed)
      },

      markSucceeded: async (input) => {
        const run = this.runs.find((item) => item.id === input.id)
        if (!run || run.status !== 'RUNNING') {
          throw new Error('running sync run not found')
        }
        const updated: B3SyncRunRecord = {
          ...run,
          status: 'SUCCEEDED',
          finishedAt: input.now,
          errorCode: null,
          errorMessage: null,
        }
        Object.assign(run, updated)
        return updated
      },

      markFailed: async (input) => {
        const run = this.runs.find((item) => item.id === input.id)
        if (!run || run.status !== 'RUNNING') {
          throw new Error('running sync run not found')
        }
        const updated: B3SyncRunRecord = {
          ...run,
          status: 'FAILED',
          finishedAt: input.now,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage.slice(0, 2000),
        }
        Object.assign(run, updated)
        return updated
      },
    }
  }

  private createPositionRepo(): PortfolioPositionRepository {
    return {
      replaceForUserEnvironment: async (input) => {
        for (const row of this.positionRows) {
          if (
            row.userId === input.userId &&
            row.environment === input.environment &&
            row.isCurrent
          ) {
            Object.assign(row, {
              isCurrent: false,
              supersededAt: input.now,
            })
          }
        }

        const inserted = input.positions.map((position) => {
          const record: PortfolioPositionRecord = {
            id: randomUUID(),
            userId: input.userId,
            environment: input.environment,
            syncRunId: input.syncRunId,
            referenceDate: input.referenceDate,
            product: position.product,
            naturalKeyHash: position.naturalKeyHash,
            instrumentCode: position.instrumentCode,
            quantity: position.quantity,
            rawPayload: position.rawPayload,
            isCurrent: true,
            supersededAt: null,
            sourceSyncedAt: input.now,
          }
          this.positionRows.push(record)
          return record
        })

        return Object.freeze(inserted)
      },

      listByUser: async (input) =>
        Object.freeze(
          this.positionRows.filter(
            (row) =>
              row.userId === input.userId &&
              row.environment === input.environment &&
              row.isCurrent &&
              (!input.cursor || row.id > input.cursor),
          )
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, input.limit),
        ),

      countByUser: async (input) =>
        this.positionRows.filter(
          (row) =>
            row.userId === input.userId &&
            row.environment === input.environment &&
            row.isCurrent,
        ).length,
    }
  }

  async runInTransaction<T>(
    work: (repos: PositionSyncRepos) => Promise<T>,
  ): Promise<T> {
    const dispatchSnapshot = this.dispatchRows.map((dispatch) => ({
      ...dispatch,
    }))
    const runSnapshot = this.runs.map((run) => ({ ...run }))
    const positionSnapshot = this.positionRows.map((position) => ({ ...position }))
    const auditLength = this.audit.events.length

    try {
      return await work({
        dispatches: this.dispatches,
        syncRuns: this.syncRuns,
        positions: this.positions,
        audit: this.audit,
      })
    } catch (error) {
      this.dispatchRows.splice(
        0,
        this.dispatchRows.length,
        ...dispatchSnapshot,
      )
      this.runs.splice(0, this.runs.length, ...runSnapshot)
      this.positionRows.splice(0, this.positionRows.length, ...positionSnapshot)
      this.audit.events.splice(auditLength)
      throw error
    }
  }
}
