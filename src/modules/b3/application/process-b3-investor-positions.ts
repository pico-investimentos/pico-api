import type { B3Config } from '../../../config/env.js'
import {
  hashSha256,
  isValidCpf,
  normalizeCpf,
} from '../../../shared/crypto/security.js'
import type { UserRepository } from '../../identity/domain/user-repository.js'
import type { B3PositionClient } from '../domain/b3-position-client.js'
import type { B3ConnectionRepository } from '../domain/b3-repositories.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'
import type { B3SyncRunRecord } from '../domain/position-types.js'
import { b3SyncAuditActor } from './b3-sync-audit-actor.js'

export type ProcessB3InvestorPositionsOutput = Readonly<{
  syncRunId: string
  status: 'SUCCEEDED' | 'FAILED'
  positionCount: number
  errorCode: string | null
}>

/** Executes one run already claimed by a queue worker. */
export class ProcessB3InvestorPositions {
  constructor(
    private readonly users: UserRepository,
    private readonly connections: B3ConnectionRepository,
    private readonly store: PositionSyncStore,
    private readonly positionClient: B3PositionClient,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    syncRunId: string
    workerRequestId: string
    now?: Date
  }): Promise<ProcessB3InvestorPositionsOutput> {
    const now = input.now ?? new Date()
    const syncRun = await this.store.syncRuns.findById(input.syncRunId)
    if (!syncRun || syncRun.status !== 'RUNNING') {
      throw new Error('B3 sync run is not claimable')
    }

    const user = await this.users.findById(syncRun.userId)
    if (!user || !user.isActive || !user.cpf) {
      return this.failRun({
        run: syncRun,
        workerRequestId: input.workerRequestId,
        now,
        errorCode: 'SYNC_USER_NOT_ELIGIBLE',
        error: new Error('Sync user is missing or inactive'),
      })
    }

    const cpf = normalizeCpf(user.cpf)
    if (!isValidCpf(cpf) || hashSha256(cpf) !== syncRun.documentHash) {
      return this.failRun({
        run: syncRun,
        workerRequestId: input.workerRequestId,
        now,
        errorCode: 'SYNC_DOCUMENT_CHANGED',
        error: new Error('Investor document changed after sync request'),
      })
    }

    const connection = await this.connections.findByUserId(user.id)
    if (connection?.status !== 'AUTHORIZED') {
      return this.failRun({
        run: syncRun,
        workerRequestId: input.workerRequestId,
        now,
        errorCode: 'B3_NOT_AUTHORIZED',
        error: new Error('B3 connection is no longer authorized'),
      })
    }
    const latestSucceeded =
      await this.store.syncRuns.findLatestSucceededByDocumentHash({
        documentHash: syncRun.documentHash,
        environment: syncRun.environment,
      })
    if (
      latestSucceeded &&
      latestSucceeded.referenceDate > syncRun.referenceDate
    ) {
      return this.failRun({
        run: syncRun,
        workerRequestId: input.workerRequestId,
        now,
        errorCode: 'STALE_REFERENCE',
        error: new Error('A newer position reference is already current'),
      })
    }

    try {
      const fetched = await this.positionClient.fetchInvestorPositions({
        documentNumber: cpf,
        referenceDate: syncRun.referenceDate,
      })

      try {
        await this.store.runInTransaction(async (repos) => {
          await repos.positions.replaceForUserEnvironment({
            userId: user.id,
            environment: this.config.environment,
            syncRunId: syncRun.id,
            referenceDate: syncRun.referenceDate,
            positions: fetched,
            now,
          })
          await repos.syncRuns.markSucceeded({ id: syncRun.id, now })
          await repos.audit.record({
            action: 'B3_POSITION_SYNC_SUCCEEDED',
            ...b3SyncAuditActor(syncRun.trigger, user.id),
            targetType: 'B3_SYNC_RUN',
            targetId: syncRun.id,
            requestId: syncRun.requestId,
            metadata: {
              environment: this.config.environment,
              trigger: syncRun.trigger,
              referenceDate: syncRun.referenceDate,
              positionCount: fetched.length,
              workerRequestId: input.workerRequestId,
            },
          })
        })
      } catch (error) {
        return this.failRun({
          run: syncRun,
          workerRequestId: input.workerRequestId,
          now,
          errorCode: 'POSITION_PERSISTENCE_FAILED',
          error,
        })
      }

      return {
        syncRunId: syncRun.id,
        status: 'SUCCEEDED',
        positionCount: fetched.length,
        errorCode: null,
      }
    } catch (error) {
      return this.failRun({
        run: syncRun,
        workerRequestId: input.workerRequestId,
        now,
        errorCode: 'B3_POSITION_FETCH_FAILED',
        error,
      })
    }
  }

  private async failRun(input: {
    run: B3SyncRunRecord
    workerRequestId: string
    now: Date
    errorCode: string
    error: unknown
  }): Promise<ProcessB3InvestorPositionsOutput> {
    const message =
      input.error instanceof Error ? input.error.message : 'unknown_error'
    await this.store.runInTransaction(async (repos) => {
      await repos.syncRuns.markFailed({
        id: input.run.id,
        now: input.now,
        errorCode: input.errorCode,
        errorMessage: message,
      })
      await repos.audit.record({
        action: 'B3_POSITION_SYNC_FAILED',
        ...b3SyncAuditActor(input.run.trigger, input.run.userId),
        targetType: 'B3_SYNC_RUN',
        targetId: input.run.id,
        requestId: input.run.requestId,
        metadata: {
          environment: input.run.environment,
          trigger: input.run.trigger,
          errorCode: input.errorCode,
          workerRequestId: input.workerRequestId,
        },
      })
    })

    return {
      syncRunId: input.run.id,
      status: 'FAILED',
      positionCount: 0,
      errorCode: input.errorCode,
    }
  }
}
