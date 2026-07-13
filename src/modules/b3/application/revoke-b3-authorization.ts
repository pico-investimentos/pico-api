import type { B3Config } from '../../../config/env.js'
import { AppError } from '../../../shared/http/app-error.js'
import {
  isValidCpf,
  normalizeCpf,
  verifyPassword,
} from '../../../shared/crypto/security.js'
import type { UserRepository } from '../../identity/domain/user-repository.js'
import type { UnitOfWork } from '../domain/b3-repositories.js'
import type { B3InvestorAuthorizationClient } from '../infrastructure/b3-investor-authorization-client.js'
import type { GetB3ConnectionOutput } from './get-b3-connection.js'

export type RevokeB3AuthorizationOutput = GetB3ConnectionOutput

export class RevokeB3Authorization {
  constructor(
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly b3Client: B3InvestorAuthorizationClient,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    userId: string
    password: string
    requestId: string
    now?: Date
  }): Promise<RevokeB3AuthorizationOutput> {
    const now = input.now ?? new Date()
    const user = await this.users.findById(input.userId)

    if (!user || !user.isActive) {
      throw new AppError(403, 'USER_NOT_ELIGIBLE', 'Usuário sem permissão para esta ação.')
    }

    if (!user.cpf) {
      throw new AppError(422, 'CPF_REQUIRED', 'Complete seu CPF antes de revogar a conexão B3.')
    }

    const cpf = normalizeCpf(user.cpf)

    if (!isValidCpf(cpf)) {
      throw new AppError(422, 'CPF_INVALID', 'O CPF cadastrado é inválido.')
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash)

    if (!passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Senha incorreta.')
    }

    const existing = await this.unitOfWork.runInTransaction(async (repos) => {
      return repos.connections.findByUserId(user.id)
    })

    if (!existing || (existing.status !== 'AUTHORIZED' && existing.status !== 'AUTHORIZATION_REQUESTED')) {
      throw new AppError(
        409,
        'B3_NOT_REVOCABLE',
        'Não há autorização B3 ativa para revogar.',
      )
    }

    if (existing.status === 'REVOKED') {
      throw new AppError(409, 'B3_ALREADY_REVOKED', 'A autorização B3 já está revogada.')
    }

    try {
      await this.b3Client.optOutInvestor(cpf)
    } catch {
      throw new AppError(
        503,
        'B3_AUTHORIZATION_REVOCATION_UNAVAILABLE',
        'Não foi possível revogar a autorização na B3.',
      )
    }

    const connection = await this.unitOfWork.runInTransaction(async (repos) => {
      const updated = await repos.connections.markRevoked({
        userId: user.id,
        now,
      })

      await repos.audit.record({
        action: 'B3_AUTHORIZATION_REVOKED',
        actorType: 'USER',
        actorId: user.id,
        targetType: 'B3_CONNECTION',
        targetId: user.id,
        requestId: input.requestId,
        metadata: {
          environment: this.config.environment,
        },
      })

      return updated
    })

    return {
      status: connection.status,
      authorizationRequestedAt: connection.authorizationRequestedAt?.toISOString() ?? null,
      authorizedAt: connection.authorizedAt?.toISOString() ?? null,
      revokedAt: connection.revokedAt?.toISOString() ?? null,
      lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    }
  }
}
