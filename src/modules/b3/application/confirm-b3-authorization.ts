import type { B3Config } from '../../../config/env.js'
import { AppError } from '../../../shared/http/app-error.js'
import { isValidCpf, normalizeCpf } from '../../../shared/crypto/security.js'
import type { UserRepository } from '../../identity/domain/user-repository.js'
import type { UnitOfWork } from '../domain/b3-repositories.js'
import type { B3InvestorAuthorizationClient } from '../infrastructure/b3-investor-authorization-client.js'
import type { GetB3ConnectionOutput } from './get-b3-connection.js'

export type ConfirmB3AuthorizationOutput = GetB3ConnectionOutput & {
  confirmed: boolean
  /** True when local status was AUTHORIZED but B3 no longer lists the CPF. */
  possiblyRevoked: boolean
}

export class ConfirmB3Authorization {
  constructor(
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly b3Client: B3InvestorAuthorizationClient,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    userId: string
    requestId: string
    now?: Date
  }): Promise<ConfirmB3AuthorizationOutput> {
    const now = input.now ?? new Date()
    const user = await this.users.findById(input.userId)

    if (!user || !user.isActive) {
      throw new AppError(403, 'USER_NOT_ELIGIBLE', 'Usuário sem permissão para esta ação.')
    }

    if (!user.cpf) {
      throw new AppError(422, 'CPF_REQUIRED', 'Complete seu CPF antes de confirmar a conexão B3.')
    }

    const cpf = normalizeCpf(user.cpf)

    if (!isValidCpf(cpf)) {
      throw new AppError(422, 'CPF_INVALID', 'O CPF cadastrado é inválido.')
    }

    let lookup
    try {
      lookup = await this.b3Client.findAuthorizationsByDocument(cpf)
    } catch {
      throw new AppError(
        503,
        'B3_AUTHORIZATION_CONFIRMATION_UNAVAILABLE',
        'Não foi possível confirmar a autorização na B3.',
      )
    }

    const match = lookup.authorizedInvestors.find(
      (investor) => normalizeCpf(investor.documentNumber) === cpf,
    )

    const { connection, possiblyRevoked } = await this.unitOfWork.runInTransaction(
      async (repos) => {
        const existing = await repos.connections.findByUserId(user.id)
        const wasAuthorized = existing?.status === 'AUTHORIZED'
        const revokedSignal = wasAuthorized && !match

        if (match) {
          const authorizedAt = new Date(match.authorizationDatetime)
          const updated = await repos.connections.markAuthorized({
            userId: user.id,
            authorizedAt: Number.isNaN(authorizedAt.getTime()) ? now : authorizedAt,
            now,
          })

          await repos.audit.record({
            action: 'B3_AUTHORIZATION_CONFIRMED',
            actorType: 'USER',
            actorId: user.id,
            targetType: 'B3_CONNECTION',
            targetId: user.id,
            requestId: input.requestId,
            metadata: {
              environment: this.config.environment,
              confirmed: true,
            },
          })

          return { connection: updated, possiblyRevoked: false }
        }

        const updated = await repos.connections.markChecked({
          userId: user.id,
          now,
        })

        await repos.audit.record({
          action: revokedSignal
            ? 'B3_AUTHORIZATION_POSSIBLY_REVOKED'
            : 'B3_AUTHORIZATION_CONFIRMATION_PENDING',
          actorType: 'USER',
          actorId: user.id,
          targetType: 'B3_CONNECTION',
          targetId: user.id,
          requestId: input.requestId,
          metadata: {
            environment: this.config.environment,
            confirmed: false,
            possiblyRevoked: revokedSignal,
          },
        })

        return { connection: updated, possiblyRevoked: revokedSignal }
      },
    )

    return {
      status: connection.status,
      authorizationRequestedAt: connection.authorizationRequestedAt?.toISOString() ?? null,
      authorizedAt: connection.authorizedAt?.toISOString() ?? null,
      revokedAt: connection.revokedAt?.toISOString() ?? null,
      lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
      confirmed: Boolean(match),
      possiblyRevoked,
    }
  }
}
