import { and, count, eq, gte, lt, ne } from 'drizzle-orm'

import type { Database, DbExecutor } from './client.js'
import type {
  AuditEventInput,
  B3AuthorizationAttemptRecord,
  B3ConnectionRecord,
  SessionRecord,
  UserRecord,
} from '../domain/types.js'
import type { SessionRepository } from '../../modules/identity/domain/session-repository.js'
import type { UserRepository } from '../../modules/identity/domain/user-repository.js'
import type {
  AuditRepository,
  B3AuthorizationAttemptRepository,
  B3ConnectionRepository,
  CreateOrGetAttemptResult,
  TransactionRepositories,
  UnitOfWork,
  UpsertRequestedResult,
} from '../../modules/b3/domain/b3-repositories.js'
import {
  auditLogs,
  b3AuthorizationAttempts,
  b3Connections,
  sessions,
  users,
} from './schema/index.js'

type DbClient = DbExecutor

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

function mapUser(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    cpf: row.cpf,
    isActive: row.isActive,
  }
}

function mapSession(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
  }
}

function mapConnection(row: typeof b3Connections.$inferSelect): B3ConnectionRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    latestAttemptId: row.latestAttemptId,
    authorizationRequestedAt: row.authorizationRequestedAt,
    authorizedAt: row.authorizedAt,
    revokedAt: row.revokedAt,
    lastCheckedAt: row.lastCheckedAt,
  }
}

function mapAttempt(
  row: typeof b3AuthorizationAttempts.$inferSelect,
): B3AuthorizationAttemptRecord {
  return {
    id: row.id,
    userId: row.userId,
    idempotencyKeyHash: row.idempotencyKeyHash,
    environment: row.environment,
    status: row.status,
    requestId: row.requestId,
    createdAt: row.createdAt,
  }
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return row ? mapUser(row) : null
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)
    return row ? mapUser(row) : null
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    userId: string
    tokenHash: string
    expiresAt: Date
  }): Promise<SessionRecord> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create session')
    }

    return mapSession(row)
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1)
    return row ? mapSession(row) : null
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, now))
  }
}

export class DrizzleB3ConnectionRepository implements B3ConnectionRepository {
  constructor(private readonly db: DbClient) {}

  async findByUserId(userId: string): Promise<B3ConnectionRecord | null> {
    const [row] = await this.db
      .select()
      .from(b3Connections)
      .where(eq(b3Connections.userId, userId))
      .limit(1)
    return row ? mapConnection(row) : null
  }

  async upsertRequested(input: {
    userId: string
    attemptId: string
    now: Date
  }): Promise<UpsertRequestedResult> {
    const existing = await this.findByUserId(input.userId)

    if (existing?.status === 'AUTHORIZED') {
      return { ok: false, reason: 'ALREADY_AUTHORIZED' }
    }

    if (existing) {
      const [row] = await this.db
        .update(b3Connections)
        .set({
          status: 'AUTHORIZATION_REQUESTED',
          latestAttemptId: input.attemptId,
          authorizationRequestedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(b3Connections.userId, input.userId),
            ne(b3Connections.status, 'AUTHORIZED'),
          ),
        )
        .returning()

      if (!row) {
        return { ok: false, reason: 'ALREADY_AUTHORIZED' }
      }

      return { ok: true, connection: mapConnection(row) }
    }

    try {
      const [row] = await this.db
        .insert(b3Connections)
        .values({
          userId: input.userId,
          status: 'AUTHORIZATION_REQUESTED',
          latestAttemptId: input.attemptId,
          authorizationRequestedAt: input.now,
        })
        .returning()

      if (!row) {
        throw new Error('Failed to create B3 connection')
      }

      return { ok: true, connection: mapConnection(row) }
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      const [row] = await this.db
        .update(b3Connections)
        .set({
          status: 'AUTHORIZATION_REQUESTED',
          latestAttemptId: input.attemptId,
          authorizationRequestedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(b3Connections.userId, input.userId),
            ne(b3Connections.status, 'AUTHORIZED'),
          ),
        )
        .returning()

      if (!row) {
        return { ok: false, reason: 'ALREADY_AUTHORIZED' }
      }

      return { ok: true, connection: mapConnection(row) }
    }
  }

  async markAuthorized(input: {
    userId: string
    authorizedAt: Date
    now: Date
  }): Promise<B3ConnectionRecord> {
    const existing = await this.findByUserId(input.userId)

    if (existing) {
      const [row] = await this.db
        .update(b3Connections)
        .set({
          status: 'AUTHORIZED',
          authorizedAt: input.authorizedAt,
          revokedAt: null,
          lastCheckedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(b3Connections.userId, input.userId))
        .returning()

      if (!row) {
        throw new Error('Failed to mark B3 connection as authorized')
      }

      return mapConnection(row)
    }

    const [row] = await this.db
      .insert(b3Connections)
      .values({
        userId: input.userId,
        status: 'AUTHORIZED',
        authorizedAt: input.authorizedAt,
        lastCheckedAt: input.now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create authorized B3 connection')
    }

    return mapConnection(row)
  }

  async markChecked(input: {
    userId: string
    now: Date
  }): Promise<B3ConnectionRecord> {
    const existing = await this.findByUserId(input.userId)

    if (existing) {
      const [row] = await this.db
        .update(b3Connections)
        .set({
          lastCheckedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(b3Connections.userId, input.userId))
        .returning()

      if (!row) {
        throw new Error('Failed to update B3 connection check timestamp')
      }

      return mapConnection(row)
    }

    const [row] = await this.db
      .insert(b3Connections)
      .values({
        userId: input.userId,
        status: 'NOT_CONNECTED',
        lastCheckedAt: input.now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create B3 connection check record')
    }

    return mapConnection(row)
  }

  async markRevoked(input: {
    userId: string
    now: Date
  }): Promise<B3ConnectionRecord> {
    const existing = await this.findByUserId(input.userId)

    if (existing) {
      const [row] = await this.db
        .update(b3Connections)
        .set({
          status: 'REVOKED',
          revokedAt: input.now,
          lastCheckedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(b3Connections.userId, input.userId))
        .returning()

      if (!row) {
        throw new Error('Failed to mark B3 connection as revoked')
      }

      return mapConnection(row)
    }

    const [row] = await this.db
      .insert(b3Connections)
      .values({
        userId: input.userId,
        status: 'REVOKED',
        revokedAt: input.now,
        lastCheckedAt: input.now,
      })
      .returning()

    if (!row) {
      throw new Error('Failed to create revoked B3 connection')
    }

    return mapConnection(row)
  }
}

export class DrizzleB3AuthorizationAttemptRepository
  implements B3AuthorizationAttemptRepository
{
  constructor(private readonly db: DbClient) {}

  async findByIdempotencyKey(input: {
    userId: string
    idempotencyKeyHash: string
  }): Promise<B3AuthorizationAttemptRecord | null> {
    const [row] = await this.db
      .select()
      .from(b3AuthorizationAttempts)
      .where(
        and(
          eq(b3AuthorizationAttempts.userId, input.userId),
          eq(b3AuthorizationAttempts.idempotencyKeyHash, input.idempotencyKeyHash),
        ),
      )
      .limit(1)

    return row ? mapAttempt(row) : null
  }

  async createOrGet(input: {
    userId: string
    idempotencyKeyHash: string
    environment: 'certification' | 'production'
    requestId: string
    now: Date
  }): Promise<CreateOrGetAttemptResult> {
    try {
      const [row] = await this.db
        .insert(b3AuthorizationAttempts)
        .values({
          userId: input.userId,
          idempotencyKeyHash: input.idempotencyKeyHash,
          environment: input.environment,
          status: 'AUTHORIZATION_REQUESTED',
          requestId: input.requestId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning()

      if (!row) {
        throw new Error('Failed to create B3 authorization attempt')
      }

      return { attempt: mapAttempt(row), created: true }
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      const existing = await this.findByIdempotencyKey({
        userId: input.userId,
        idempotencyKeyHash: input.idempotencyKeyHash,
      })

      if (!existing) {
        throw error
      }

      return { attempt: existing, created: false }
    }
  }

  async countRecentByUser(input: { userId: string; since: Date }): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(b3AuthorizationAttempts)
      .where(
        and(
          eq(b3AuthorizationAttempts.userId, input.userId),
          gte(b3AuthorizationAttempts.createdAt, input.since),
        ),
      )

    return Number(row?.value ?? 0)
  }
}

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: DbClient) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.db.insert(auditLogs).values({
      action: event.action,
      actorType: event.actorType,
      actorId: event.actorId,
      targetType: event.targetType,
      targetId: event.targetId,
      requestId: event.requestId,
      metadata: event.metadata ?? {},
    })
  }
}

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  async runInTransaction<T>(
    work: (repos: TransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const repos: TransactionRepositories = {
        connections: new DrizzleB3ConnectionRepository(tx),
        attempts: new DrizzleB3AuthorizationAttemptRepository(tx),
        audit: new DrizzleAuditRepository(tx),
      }
      return work(repos)
    })
  }
}
