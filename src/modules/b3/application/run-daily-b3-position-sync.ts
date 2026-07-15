import type { B3Config } from '../../../config/env.js'
import { AppError } from '../../../shared/http/app-error.js'
import type { B3SystemClient } from '../domain/b3-system-client.js'
import { calendarDateInSaoPaulo } from '../domain/position-dates.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'

export type RunDailyB3PositionSyncOutput = Readonly<{
  lastLoadedDate: string
  dispatchId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'SUPERSEDED'
  reused: boolean
}>

/** Creates a durable paginated dispatch; it never scans all users inline. */
export class RunDailyB3PositionSync {
  constructor(
    private readonly systemClient: B3SystemClient,
    private readonly store: PositionSyncStore,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    requestId: string
    now?: Date
  }): Promise<RunDailyB3PositionSyncOutput> {
    const now = input.now ?? new Date()
    let lastLoadedDate: string
    try {
      lastLoadedDate = await this.systemClient.getLastLoadedDate()
    } catch {
      throw new AppError(
        503,
        'B3_LAST_LOAD_UNAVAILABLE',
        'Não foi possível verificar a carga diária da B3.',
      )
    }

    const result = await this.store.runInTransaction(async (repos) => {
      const dispatch = await repos.dispatches.createOrGet({
        environment: this.config.environment,
        referenceDate: lastLoadedDate,
        businessDay: calendarDateInSaoPaulo(now),
        requestId: input.requestId,
        now,
      })
      if (dispatch.created) {
        await repos.audit.record({
          action: 'B3_POSITION_DISPATCH_CREATED',
          actorType: 'SYSTEM',
          actorId: null,
          targetType: 'B3_POSITION_DISPATCH',
          targetId: dispatch.dispatch.id,
          requestId: input.requestId,
          metadata: {
            environment: this.config.environment,
            referenceDate: lastLoadedDate,
          },
        })
      }
      return dispatch
    })

    return {
      lastLoadedDate,
      dispatchId: result.dispatch.id,
      status: result.dispatch.status,
      reused: !result.created,
    }
  }
}
