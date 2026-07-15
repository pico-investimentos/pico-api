import type { B3Config } from '../../../config/env.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'
import type { ProcessB3InvestorPositions } from './process-b3-investor-positions.js'
import type {
  ProcessB3PositionDispatch,
  ProcessB3PositionDispatchOutput,
} from './process-b3-position-dispatch.js'

export type ProcessPendingB3PositionSyncsOutput = Readonly<{
  dispatch: ProcessB3PositionDispatchOutput
  recoveredStale: number
  claimed: number
  results: readonly {
    syncRunId: string
    status: 'SUCCEEDED' | 'FAILED' | 'ERROR'
    errorCode: string | null
  }[]
}>

const DEFAULT_BATCH_SIZE = 1
const STALE_RUN_AFTER_MS = 60 * 60 * 1000

export class ProcessPendingB3PositionSyncs {
  constructor(
    private readonly store: PositionSyncStore,
    private readonly processDispatch: ProcessB3PositionDispatch,
    private readonly processPositions: ProcessB3InvestorPositions,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    requestId: string
    batchSize?: number
    now?: Date
  }): Promise<ProcessPendingB3PositionSyncsOutput> {
    const now = input.now ?? new Date()
    const batchSize = Math.min(
      Math.max(input.batchSize ?? DEFAULT_BATCH_SIZE, 1),
      1,
    )
    let dispatch: ProcessB3PositionDispatchOutput
    try {
      dispatch = await this.processDispatch.execute({
        requestId: input.requestId,
        now,
      })
    } catch {
      dispatch = {
        dispatchId: null,
        scanned: 0,
        enqueued: 0,
        reused: 0,
        skipped: 0,
        completed: false,
        errorCode: 'DISPATCH_PROCESSING_ERROR',
      }
    }
    const stale = await this.store.syncRuns.findStaleRunning({
      environment: this.config.environment,
      startedBefore: new Date(now.getTime() - STALE_RUN_AFTER_MS),
      limit: batchSize,
    })
    for (const run of stale) {
      await this.store.runInTransaction(async (repos) => {
        await repos.syncRuns.markFailed({
          id: run.id,
          now,
          errorCode: 'STALE_SYNC_RUN',
          errorMessage: 'Synchronization exceeded the stale-run threshold',
        })
        await repos.audit.record({
          action: 'B3_POSITION_SYNC_FAILED',
          actorType: run.trigger === 'MANUAL' ? 'USER' : 'SYSTEM',
          actorId: run.trigger === 'MANUAL' ? run.userId : null,
          targetType: 'B3_SYNC_RUN',
          targetId: run.id,
          requestId: run.requestId,
          metadata: {
            environment: run.environment,
            trigger: run.trigger,
            errorCode: 'STALE_SYNC_RUN',
            workerRequestId: input.requestId,
          },
        })
      })
    }

    const claimed = await this.store.syncRuns.claimPending({
      environment: this.config.environment,
      limit: batchSize,
      now,
    })
    const results: Array<{
      syncRunId: string
      status: 'SUCCEEDED' | 'FAILED' | 'ERROR'
      errorCode: string | null
    }> = []

    for (const run of claimed) {
      try {
        const result = await this.processPositions.execute({
          syncRunId: run.id,
          workerRequestId: input.requestId,
          now,
        })
        results.push({
          syncRunId: run.id,
          status: result.status,
          errorCode: result.errorCode,
        })
      } catch {
        results.push({
          syncRunId: run.id,
          status: 'ERROR',
          errorCode: 'INTERNAL_PROCESSING_ERROR',
        })
      }
    }

    return {
      dispatch,
      recoveredStale: stale.length,
      claimed: claimed.length,
      results: Object.freeze(results),
    }
  }
}
