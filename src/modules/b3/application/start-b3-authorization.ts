import type { B3Config } from '../../../config/env.js'
import { AppError } from '../../../shared/http/app-error.js'
import { hashSha256, isValidCpf, normalizeCpf } from '../../../shared/crypto/security.js'
import type { UserRepository } from '../../identity/domain/user-repository.js'
import type { AuditRepository, UnitOfWork } from '../domain/b3-repositories.js'

export type StartB3AuthorizationInput = {
  userId: string
  idempotencyKey: string
  requestId: string
  now?: Date
}

export type StartB3AuthorizationOutput = {
  attemptId: string
  connectionStatus: 'AUTHORIZATION_REQUESTED'
  authorizationUrl: string
  reused: boolean
}

const MAX_ATTEMPTS = 5
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000

export class StartB3Authorization {
  constructor(
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly config: B3Config,
  ) {}

  async execute(input: StartB3AuthorizationInput): Promise<StartB3AuthorizationOutput> {
    const now = input.now ?? new Date()
    const user = await this.users.findById(input.userId)

    if (!user || !user.isActive) {
      throw new AppError(403, 'USER_NOT_ELIGIBLE', 'Usuário sem permissão para esta ação.')
    }

    if (!user.cpf) {
      throw new AppError(422, 'CPF_REQUIRED', 'Complete seu CPF antes de conectar com a B3.')
    }

    const cpf = normalizeCpf(user.cpf)

    if (!isValidCpf(cpf)) {
      throw new AppError(422, 'CPF_INVALID', 'O CPF cadastrado é inválido.')
    }

    const idempotencyKeyHash = hashSha256(input.idempotencyKey)

    return this.unitOfWork.runInTransaction(async (repos) => {
      const connection = await repos.connections.findByUserId(user.id)

      if (connection?.status === 'AUTHORIZED') {
        await this.recordRejected(repos.audit, {
          userId: user.id,
          requestId: input.requestId,
          reason: 'B3_ALREADY_AUTHORIZED',
        })
        throw new AppError(
          409,
          'B3_ALREADY_AUTHORIZED',
          'A conexão com a B3 já está autorizada.',
        )
      }

      const existingAttempt = await repos.attempts.findByIdempotencyKey({
        userId: user.id,
        idempotencyKeyHash,
      })

      if (existingAttempt) {
        await repos.audit.record({
          action: 'B3_AUTHORIZATION_REQUEST_REUSED',
          actorType: 'USER',
          actorId: user.id,
          targetType: 'B3_CONNECTION',
          targetId: user.id,
          requestId: input.requestId,
          metadata: {
            attemptId: existingAttempt.id,
            environment: this.config.environment,
          },
        })

        return {
          attemptId: existingAttempt.id,
          connectionStatus: 'AUTHORIZATION_REQUESTED' as const,
          authorizationUrl: this.config.optInUrl,
          reused: true,
        }
      }

      const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS)
      const recentCount = await repos.attempts.countRecentByUser({
        userId: user.id,
        since,
      })

      if (recentCount >= MAX_ATTEMPTS) {
        await this.recordRejected(repos.audit, {
          userId: user.id,
          requestId: input.requestId,
          reason: 'TOO_MANY_ATTEMPTS',
        })
        throw new AppError(
          429,
          'TOO_MANY_ATTEMPTS',
          'Muitas tentativas. Tente novamente mais tarde.',
        )
      }

      const { attempt, created } = await repos.attempts.createOrGet({
        userId: user.id,
        idempotencyKeyHash,
        environment: this.config.environment,
        requestId: input.requestId,
        now,
      })

      if (!created) {
        await repos.audit.record({
          action: 'B3_AUTHORIZATION_REQUEST_REUSED',
          actorType: 'USER',
          actorId: user.id,
          targetType: 'B3_CONNECTION',
          targetId: user.id,
          requestId: input.requestId,
          metadata: {
            attemptId: attempt.id,
            environment: this.config.environment,
          },
        })

        return {
          attemptId: attempt.id,
          connectionStatus: 'AUTHORIZATION_REQUESTED' as const,
          authorizationUrl: this.config.optInUrl,
          reused: true,
        }
      }

      const upsertResult = await repos.connections.upsertRequested({
        userId: user.id,
        attemptId: attempt.id,
        now,
      })

      if (!upsertResult.ok) {
        await this.recordRejected(repos.audit, {
          userId: user.id,
          requestId: input.requestId,
          reason: 'B3_ALREADY_AUTHORIZED',
          attemptId: attempt.id,
        })
        throw new AppError(
          409,
          'B3_ALREADY_AUTHORIZED',
          'A conexão com a B3 já está autorizada.',
        )
      }

      await repos.audit.record({
        action: 'B3_AUTHORIZATION_REQUESTED',
        actorType: 'USER',
        actorId: user.id,
        targetType: 'B3_CONNECTION',
        targetId: user.id,
        requestId: input.requestId,
        metadata: {
          attemptId: attempt.id,
          environment: this.config.environment,
        },
      })

      return {
        attemptId: attempt.id,
        connectionStatus: 'AUTHORIZATION_REQUESTED' as const,
        authorizationUrl: this.config.optInUrl,
        reused: false,
      }
    })
  }

  private async recordRejected(
    audit: AuditRepository,
    input: {
      userId: string
      requestId: string
      reason: string
      attemptId?: string
    },
  ) {
    await audit.record({
      action: 'B3_AUTHORIZATION_REQUEST_REJECTED',
      actorType: 'USER',
      actorId: input.userId,
      targetType: 'B3_CONNECTION',
      targetId: input.userId,
      requestId: input.requestId,
      metadata: {
        reason: input.reason,
        environment: this.config.environment,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      },
    })
  }
}
