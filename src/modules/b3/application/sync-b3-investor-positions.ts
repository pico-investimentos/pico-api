import type { B3Config } from '../../../config/env.js'
import {
  hashSha256,
  isValidCpf,
  normalizeCpf,
} from '../../../shared/crypto/security.js'
import { AppError } from '../../../shared/http/app-error.js'
import type { UserRepository } from '../../identity/domain/user-repository.js'
import type { B3ConnectionRepository } from '../domain/b3-repositories.js'
import type { B3SystemClient } from '../domain/b3-system-client.js'
import { calendarDateInSaoPaulo } from '../domain/position-dates.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'
import type { B3SyncRunRecord, B3SyncTrigger } from '../domain/position-types.js'
import { b3SyncAuditActor } from './b3-sync-audit-actor.js'

export type SyncB3InvestorPositionsOutput = Readonly<{
  syncRunId: string
  status: B3SyncRunRecord['status']
  businessDay: string
  referenceDate: string
  reused: boolean
  positionCount: number
  errorCode: string | null
}>

const STALE_RUN_AFTER_MS = 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

/** Creates or reuses a durable daily sync request. It never calls B3 inline. */
export class SyncB3InvestorPositions {
  constructor(
    private readonly users: UserRepository,
    private readonly connections: B3ConnectionRepository,
    private readonly store: PositionSyncStore,
    private readonly systemClient: B3SystemClient,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    userId: string
    trigger: B3SyncTrigger
    requestId: string
    referenceDate?: string
    businessDay?: string
    now?: Date
  }): Promise<SyncB3InvestorPositionsOutput> {
    const now = input.now ?? new Date()
    const user = await this.users.findById(input.userId)

    if (!user || !user.isActive) {
      throw new AppError(
        403,
        'USER_NOT_ELIGIBLE',
        'Usuário sem permissão para esta ação.',
      )
    }

    if (!user.cpf) {
      throw new AppError(
        422,
        'CPF_REQUIRED',
        'Complete seu CPF antes de sincronizar a carteira.',
      )
    }

    const cpf = normalizeCpf(user.cpf)
    if (!isValidCpf(cpf)) {
      throw new AppError(422, 'CPF_INVALID', 'O CPF cadastrado é inválido.')
    }

    const connection = await this.connections.findByUserId(user.id)
    if (connection?.status !== 'AUTHORIZED') {
      throw new AppError(
        409,
        'B3_NOT_AUTHORIZED',
        'Conecte e confirme a autorização B3 antes de sincronizar posições.',
      )
    }

    const documentHash = hashSha256(cpf)
    const businessDay = input.businessDay ?? calendarDateInSaoPaulo(now)
    let referenceDate = input.referenceDate
    if (!referenceDate) {
      try {
        referenceDate = await this.systemClient.getLastLoadedDate()
      } catch {
        throw new AppError(
          503,
          'B3_LAST_LOAD_UNAVAILABLE',
          'Não foi possível verificar a carga diária da B3.',
        )
      }
    }
    if (
      !DATE_PATTERN.test(referenceDate) ||
      !DATE_PATTERN.test(businessDay)
    ) {
      throw new Error('Invalid B3 position date')
    }

    const latest =
      await this.store.syncRuns.findLatestSucceededByDocumentHash({
        documentHash,
        environment: this.config.environment,
      })
    if (latest && latest.referenceDate >= referenceDate) {
      return this.toOutput(latest, true)
    }

    const existing =
      await this.store.syncRuns.findByDocumentHashEnvironmentBusinessDay({
        documentHash,
        environment: this.config.environment,
        businessDay,
      })

    if (existing) {
      const recovered = await this.recoverStaleRun({
        run: existing,
        requestId: input.requestId,
        now,
      })
      return this.toOutput(recovered, true)
    }

    try {
      const syncRun = await this.store.runInTransaction(async (repos) => {
        const created = await repos.syncRuns.createPending({
          userId: user.id,
          documentHash,
          environment: this.config.environment,
          trigger: input.trigger,
          requestId: input.requestId,
          businessDay,
          referenceDate,
          now,
        })
        await repos.audit.record({
          action: 'B3_POSITION_SYNC_REQUESTED',
          ...b3SyncAuditActor(input.trigger, user.id),
          targetType: 'B3_SYNC_RUN',
          targetId: created.id,
          requestId: input.requestId,
          metadata: {
            environment: this.config.environment,
            trigger: input.trigger,
            referenceDate,
          },
        })
        return created
      })

      return this.toOutput(syncRun, false)
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced =
          await this.store.syncRuns.findByDocumentHashEnvironmentBusinessDay({
            documentHash,
            environment: this.config.environment,
            businessDay,
          })
        if (raced) {
          return this.toOutput(raced, true)
        }
      }
      throw error
    }
  }

  private async recoverStaleRun(input: {
    run: B3SyncRunRecord
    requestId: string
    now: Date
  }): Promise<B3SyncRunRecord> {
    if (
      input.run.status !== 'RUNNING' ||
      !input.run.startedAt ||
      input.run.startedAt.getTime() > input.now.getTime() - STALE_RUN_AFTER_MS
    ) {
      return input.run
    }

    return this.store.runInTransaction(async (repos) => {
      const failed = await repos.syncRuns.markFailed({
        id: input.run.id,
        now: input.now,
        errorCode: 'STALE_SYNC_RUN',
        errorMessage: 'Synchronization exceeded the stale-run threshold',
      })
      await repos.audit.record({
        action: 'B3_POSITION_SYNC_FAILED',
        ...b3SyncAuditActor(input.run.trigger, input.run.userId),
        targetType: 'B3_SYNC_RUN',
        targetId: input.run.id,
        requestId: input.requestId,
        metadata: {
          environment: input.run.environment,
          trigger: input.run.trigger,
          errorCode: 'STALE_SYNC_RUN',
        },
      })
      return failed
    })
  }

  private async toOutput(
    run: B3SyncRunRecord,
    reused: boolean,
  ): Promise<SyncB3InvestorPositionsOutput> {
    const positionCount =
      run.status === 'SUCCEEDED'
        ? await this.store.positions.countByUser({
            userId: run.userId,
            environment: run.environment,
          })
        : 0

    return {
      syncRunId: run.id,
      status: run.status,
      businessDay: run.businessDay,
      referenceDate: run.referenceDate,
      reused,
      positionCount,
      errorCode: run.errorCode,
    }
  }
}
