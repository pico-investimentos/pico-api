import type { B3ConnectionStatus } from '../../../shared/domain/types.js'
import type { B3ConnectionRepository } from '../domain/b3-repositories.js'

export type GetB3ConnectionOutput = {
  status: B3ConnectionStatus
  authorizationRequestedAt: string | null
  authorizedAt: string | null
  revokedAt: string | null
  lastCheckedAt: string | null
}

export class GetB3Connection {
  constructor(private readonly connections: B3ConnectionRepository) {}

  async execute(userId: string): Promise<GetB3ConnectionOutput> {
    const connection = await this.connections.findByUserId(userId)

    if (!connection) {
      return {
        status: 'NOT_CONNECTED',
        authorizationRequestedAt: null,
        authorizedAt: null,
        revokedAt: null,
        lastCheckedAt: null,
      }
    }

    return {
      status: connection.status,
      authorizationRequestedAt: connection.authorizationRequestedAt?.toISOString() ?? null,
      authorizedAt: connection.authorizedAt?.toISOString() ?? null,
      revokedAt: connection.revokedAt?.toISOString() ?? null,
      lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    }
  }
}
