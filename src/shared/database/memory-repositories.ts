import { randomUUID } from 'node:crypto'

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
import type {
  AuditEventInput,
  B3AuthorizationAttemptRecord,
  B3ConnectionRecord,
  SessionRecord,
  UserRecord,
} from '../domain/types.js'

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>()

  seed(user: UserRecord) {
    this.users.set(user.id, user)
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return (
      [...this.users.values()].find(
        (user) => user.email.toLowerCase() === email.toLowerCase(),
      ) ?? null
    )
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>()

  async create(input: {
    userId: string
    tokenHash: string
    expiresAt: Date
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    }
    this.sessions.set(session.tokenHash, session)
    return session
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash)
  }

  async deleteExpired(now: Date): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key)
      }
    }
  }
}

export class InMemoryB3ConnectionRepository implements B3ConnectionRepository {
  private readonly connections = new Map<string, B3ConnectionRecord>()

  seed(connection: B3ConnectionRecord) {
    this.connections.set(connection.userId, connection)
  }

  async findByUserId(userId: string): Promise<B3ConnectionRecord | null> {
    return this.connections.get(userId) ?? null
  }

  async upsertRequested(input: {
    userId: string
    attemptId: string
    now: Date
  }): Promise<UpsertRequestedResult> {
    const existing = this.connections.get(input.userId)

    if (existing?.status === 'AUTHORIZED') {
      return { ok: false, reason: 'ALREADY_AUTHORIZED' }
    }

    const record: B3ConnectionRecord = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      status: 'AUTHORIZATION_REQUESTED',
      latestAttemptId: input.attemptId,
      authorizationRequestedAt: input.now,
      authorizedAt: existing?.authorizedAt ?? null,
      revokedAt: existing?.revokedAt ?? null,
      lastCheckedAt: existing?.lastCheckedAt ?? null,
    }
    this.connections.set(input.userId, record)
    return { ok: true, connection: record }
  }

  async markAuthorized(input: {
    userId: string
    authorizedAt: Date
    now: Date
  }): Promise<B3ConnectionRecord> {
    const existing = this.connections.get(input.userId)
    const record: B3ConnectionRecord = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      status: 'AUTHORIZED',
      latestAttemptId: existing?.latestAttemptId ?? null,
      authorizationRequestedAt: existing?.authorizationRequestedAt ?? null,
      authorizedAt: input.authorizedAt,
      revokedAt: null,
      lastCheckedAt: input.now,
    }
    this.connections.set(input.userId, record)
    return record
  }

  async markChecked(input: {
    userId: string
    now: Date
  }): Promise<B3ConnectionRecord> {
    const existing = this.connections.get(input.userId)
    const record: B3ConnectionRecord = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      status: existing?.status ?? 'NOT_CONNECTED',
      latestAttemptId: existing?.latestAttemptId ?? null,
      authorizationRequestedAt: existing?.authorizationRequestedAt ?? null,
      authorizedAt: existing?.authorizedAt ?? null,
      revokedAt: existing?.revokedAt ?? null,
      lastCheckedAt: input.now,
    }
    this.connections.set(input.userId, record)
    return record
  }

  async markRevoked(input: {
    userId: string
    now: Date
  }): Promise<B3ConnectionRecord> {
    const existing = this.connections.get(input.userId)
    const record: B3ConnectionRecord = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      status: 'REVOKED',
      latestAttemptId: existing?.latestAttemptId ?? null,
      authorizationRequestedAt: existing?.authorizationRequestedAt ?? null,
      authorizedAt: existing?.authorizedAt ?? null,
      revokedAt: input.now,
      lastCheckedAt: input.now,
    }
    this.connections.set(input.userId, record)
    return record
  }
}

export class InMemoryB3AuthorizationAttemptRepository
  implements B3AuthorizationAttemptRepository
{
  private readonly attempts: B3AuthorizationAttemptRecord[] = []

  async findByIdempotencyKey(input: {
    userId: string
    idempotencyKeyHash: string
  }): Promise<B3AuthorizationAttemptRecord | null> {
    return (
      this.attempts.find(
        (attempt) =>
          attempt.userId === input.userId &&
          attempt.idempotencyKeyHash === input.idempotencyKeyHash,
      ) ?? null
    )
  }

  async createOrGet(input: {
    userId: string
    idempotencyKeyHash: string
    environment: 'certification' | 'production'
    requestId: string
    now: Date
  }): Promise<CreateOrGetAttemptResult> {
    const existing = await this.findByIdempotencyKey({
      userId: input.userId,
      idempotencyKeyHash: input.idempotencyKeyHash,
    })

    if (existing) {
      return { attempt: existing, created: false }
    }

    const attempt: B3AuthorizationAttemptRecord = {
      id: randomUUID(),
      userId: input.userId,
      idempotencyKeyHash: input.idempotencyKeyHash,
      environment: input.environment,
      status: 'AUTHORIZATION_REQUESTED',
      requestId: input.requestId,
      createdAt: input.now,
    }
    this.attempts.push(attempt)
    return { attempt, created: true }
  }

  async countRecentByUser(input: { userId: string; since: Date }): Promise<number> {
    return this.attempts.filter(
      (attempt) => attempt.userId === input.userId && attempt.createdAt >= input.since,
    ).length
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditEventInput[] = []

  async record(event: AuditEventInput): Promise<void> {
    this.events.push(event)
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly repos: TransactionRepositories) {}

  async runInTransaction<T>(
    work: (repos: TransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return work(this.repos)
  }
}
