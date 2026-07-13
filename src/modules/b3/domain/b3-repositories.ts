import type {
  AuditEventInput,
  B3AuthorizationAttemptRecord,
  B3ConnectionRecord,
} from '../../../shared/domain/types.js'

export type CreateOrGetAttemptResult = Readonly<{
  attempt: B3AuthorizationAttemptRecord
  created: boolean
}>

export type UpsertRequestedResult =
  | Readonly<{ ok: true; connection: B3ConnectionRecord }>
  | Readonly<{ ok: false; reason: 'ALREADY_AUTHORIZED' }>

export interface B3ConnectionRepository {
  findByUserId(userId: string): Promise<B3ConnectionRecord | null>
  upsertRequested(input: {
    userId: string
    attemptId: string
    now: Date
  }): Promise<UpsertRequestedResult>
  markAuthorized(input: {
    userId: string
    authorizedAt: Date
    now: Date
  }): Promise<B3ConnectionRecord>
  markChecked(input: {
    userId: string
    now: Date
  }): Promise<B3ConnectionRecord>
  markRevoked(input: {
    userId: string
    now: Date
  }): Promise<B3ConnectionRecord>
}

export interface B3AuthorizationAttemptRepository {
  findByIdempotencyKey(input: {
    userId: string
    idempotencyKeyHash: string
  }): Promise<B3AuthorizationAttemptRecord | null>
  createOrGet(input: {
    userId: string
    idempotencyKeyHash: string
    environment: 'certification' | 'production'
    requestId: string
    now: Date
  }): Promise<CreateOrGetAttemptResult>
  countRecentByUser(input: { userId: string; since: Date }): Promise<number>
}

export interface AuditRepository {
  record(event: AuditEventInput): Promise<void>
}

export interface UnitOfWork {
  runInTransaction<T>(work: (repos: TransactionRepositories) => Promise<T>): Promise<T>
}

export type TransactionRepositories = Readonly<{
  connections: B3ConnectionRepository
  attempts: B3AuthorizationAttemptRepository
  audit: AuditRepository
}>
