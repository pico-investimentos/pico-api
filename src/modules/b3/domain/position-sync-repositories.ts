import type {
  B3PositionDispatchRecord,
  B3SyncRunRecord,
  B3SyncTrigger,
  PortfolioPositionInput,
  PortfolioPositionRecord,
} from '../domain/position-types.js'
import type { AuditRepository } from './b3-repositories.js'

export interface B3PositionDispatchRepository {
  createOrGet(input: {
    environment: 'certification' | 'production'
    referenceDate: string
    businessDay: string
    requestId: string
    now: Date
  }): Promise<{ dispatch: B3PositionDispatchRecord; created: boolean }>
  claim(input: {
    environment: 'certification' | 'production'
    leaseToken: string
    leaseExpiresAt: Date
    now: Date
  }): Promise<B3PositionDispatchRecord | null>
  advance(input: {
    id: string
    leaseToken: string
    expectedCursorUserId: string | null
    cursorUserId: string | null
    completed: boolean
    now: Date
  }): Promise<B3PositionDispatchRecord>
}

export interface B3SyncRunRepository {
  findByDocumentHashEnvironmentBusinessDay(input: {
    documentHash: string
    environment: 'certification' | 'production'
    businessDay: string
  }): Promise<B3SyncRunRecord | null>
  findLatestByUser(input: {
    userId: string
    environment: 'certification' | 'production'
  }): Promise<B3SyncRunRecord | null>
  findLatestSucceededByDocumentHash(input: {
    documentHash: string
    environment: 'certification' | 'production'
  }): Promise<B3SyncRunRecord | null>
  findById(id: string): Promise<B3SyncRunRecord | null>
  findStaleRunning(input: {
    environment: 'certification' | 'production'
    startedBefore: Date
    limit: number
  }): Promise<readonly B3SyncRunRecord[]>
  createPending(input: {
    userId: string
    documentHash: string
    environment: 'certification' | 'production'
    trigger: B3SyncTrigger
    requestId: string
    businessDay: string
    referenceDate: string
    now: Date
  }): Promise<B3SyncRunRecord>
  claimPending(input: {
    environment: 'certification' | 'production'
    limit: number
    now: Date
  }): Promise<readonly B3SyncRunRecord[]>
  markSucceeded(input: { id: string; now: Date }): Promise<B3SyncRunRecord>
  markFailed(input: {
    id: string
    now: Date
    errorCode: string
    errorMessage: string
  }): Promise<B3SyncRunRecord>
}

export interface PortfolioPositionRepository {
  replaceForUserEnvironment(input: {
    userId: string
    environment: 'certification' | 'production'
    syncRunId: string
    referenceDate: string
    positions: readonly PortfolioPositionInput[]
    now: Date
  }): Promise<readonly PortfolioPositionRecord[]>
  listByUser(input: {
    userId: string
    environment: 'certification' | 'production'
    cursor?: string
    limit: number
  }): Promise<readonly PortfolioPositionRecord[]>
  countByUser(input: {
    userId: string
    environment: 'certification' | 'production'
  }): Promise<number>
}

export type PositionSyncRepos = Readonly<{
  dispatches: B3PositionDispatchRepository
  syncRuns: B3SyncRunRepository
  positions: PortfolioPositionRepository
  audit: AuditRepository
}>

export interface PositionSyncStore extends PositionSyncRepos {
  runInTransaction<T>(work: (repos: PositionSyncRepos) => Promise<T>): Promise<T>
}
