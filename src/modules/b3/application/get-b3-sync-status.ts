import type { B3Config } from '../../../config/env.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'
import type { B3SyncRunRecord } from '../domain/position-types.js'

export type GetB3SyncStatusOutput = Readonly<{
  syncRun: null | {
    id: string
    status: B3SyncRunRecord['status']
    trigger: B3SyncRunRecord['trigger']
    businessDay: string
    referenceDate: string
    startedAt: string | null
    finishedAt: string | null
    errorCode: string | null
  }
}>

export class GetB3SyncStatus {
  constructor(
    private readonly store: PositionSyncStore,
    private readonly config: B3Config,
  ) {}

  async execute(input: { userId: string }): Promise<GetB3SyncStatusOutput> {
    const syncRun = await this.store.syncRuns.findLatestByUser({
      userId: input.userId,
      environment: this.config.environment,
    })

    if (!syncRun) {
      return { syncRun: null }
    }

    return {
      syncRun: {
        id: syncRun.id,
        status: syncRun.status,
        trigger: syncRun.trigger,
        businessDay: syncRun.businessDay,
        referenceDate: syncRun.referenceDate,
        startedAt: syncRun.startedAt?.toISOString() ?? null,
        finishedAt: syncRun.finishedAt?.toISOString() ?? null,
        errorCode: syncRun.errorCode,
      },
    }
  }
}
