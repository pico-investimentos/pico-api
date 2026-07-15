import { randomUUID } from 'node:crypto'

import type { B3Config } from '../../../config/env.js'
import { AppError } from '../../../shared/http/app-error.js'
import type { B3ConnectionRepository } from '../domain/b3-repositories.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'
import type { SyncB3InvestorPositions } from './sync-b3-investor-positions.js'

export type ProcessB3PositionDispatchOutput = Readonly<{
  dispatchId: string | null
  scanned: number
  enqueued: number
  reused: number
  skipped: number
  completed: boolean
  errorCode: string | null
}>

const DEFAULT_PAGE_SIZE = 100
const DISPATCH_LEASE_MS = 4 * 60 * 1000

export class ProcessB3PositionDispatch {
  constructor(
    private readonly connections: B3ConnectionRepository,
    private readonly store: PositionSyncStore,
    private readonly syncPositions: SyncB3InvestorPositions,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    requestId: string
    pageSize?: number
    now?: Date
  }): Promise<ProcessB3PositionDispatchOutput> {
    const now = input.now ?? new Date()
    const pageSize = Math.min(
      Math.max(input.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      500,
    )
    const leaseToken = randomUUID()
    const dispatch = await this.store.dispatches.claim({
      environment: this.config.environment,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + DISPATCH_LEASE_MS),
      now,
    })
    if (!dispatch) {
      return {
        dispatchId: null,
        scanned: 0,
        enqueued: 0,
        reused: 0,
        skipped: 0,
        completed: true,
        errorCode: null,
      }
    }

    const userIds = await this.connections.listUserIdsByStatus({
      status: 'AUTHORIZED',
      ...(dispatch.cursorUserId
        ? { afterUserId: dispatch.cursorUserId }
        : {}),
      limit: pageSize,
    })
    let enqueued = 0
    let reused = 0
    let skipped = 0

    for (const userId of userIds) {
      try {
        const result = await this.syncPositions.execute({
          userId,
          trigger: 'CRON',
          requestId: input.requestId,
          referenceDate: dispatch.referenceDate,
          businessDay: dispatch.businessDay,
          now,
        })
        if (
          result.reused &&
          result.referenceDate !== dispatch.referenceDate
        ) {
          throw new Error('Dispatch is blocked by another daily CPF run')
        }
        if (result.reused) {
          reused += 1
        } else {
          enqueued += 1
        }
      } catch (error) {
        if (error instanceof AppError && error.status < 500) {
          skipped += 1
          continue
        }
        throw error
      }
    }

    const completed = userIds.length < pageSize
    const cursorUserId = userIds.at(-1) ?? dispatch.cursorUserId
    await this.store.runInTransaction(async (repos) => {
      await repos.dispatches.advance({
        id: dispatch.id,
        leaseToken,
        expectedCursorUserId: dispatch.cursorUserId,
        cursorUserId,
        completed,
        now,
      })
      if (completed) {
        await repos.audit.record({
          action: 'B3_POSITION_DISPATCH_SUCCEEDED',
          actorType: 'SYSTEM',
          actorId: null,
          targetType: 'B3_POSITION_DISPATCH',
          targetId: dispatch.id,
          requestId: dispatch.requestId,
          metadata: {
            environment: dispatch.environment,
            referenceDate: dispatch.referenceDate,
          },
        })
      }
    })

    return {
      dispatchId: dispatch.id,
      scanned: userIds.length,
      enqueued,
      reused,
      skipped,
      completed,
      errorCode: null,
    }
  }
}
