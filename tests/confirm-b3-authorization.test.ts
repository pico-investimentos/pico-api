import { describe, expect, it } from 'vitest'

import { ConfirmB3Authorization } from '../src/modules/b3/application/confirm-b3-authorization.js'
import { hashPassword } from '../src/shared/crypto/security.js'
import {
  InMemoryAuditRepository,
  InMemoryB3AuthorizationAttemptRepository,
  InMemoryB3ConnectionRepository,
  InMemoryUnitOfWork,
  InMemoryUserRepository,
} from '../src/shared/database/memory-repositories.js'
import { InMemoryB3InvestorAuthorizationClient } from '../src/modules/b3/infrastructure/b3-investor-authorization-client.js'
import { testConfig } from './app.test.js'

const now = new Date('2026-07-10T12:00:00.000Z')
const userId = '11111111-1111-1111-1111-111111111111'
const cpf = '33433637822'

async function createUseCase(options?: { authorized?: boolean; cpf?: string | null }) {
  const users = new InMemoryUserRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })
  const authorizedDocuments = new Set(options?.authorized === false ? [] : [cpf])
  const b3Client = new InMemoryB3InvestorAuthorizationClient(authorizedDocuments)

  users.seed({
    id: userId,
    email: 'cliente@pico.test',
    passwordHash: await hashPassword('password123'),
    cpf: options?.cpf === undefined ? cpf : options.cpf,
    isActive: true,
  })

  connections.seed({
    id: '22222222-2222-2222-2222-222222222222',
    userId,
    status: 'AUTHORIZATION_REQUESTED',
    latestAttemptId: null,
    authorizationRequestedAt: now,
    authorizedAt: null,
    revokedAt: null,
    lastCheckedAt: null,
  })

  return {
    audit,
    connections,
    useCase: new ConfirmB3Authorization(users, unitOfWork, b3Client, testConfig.b3),
  }
}

describe('ConfirmB3Authorization', () => {
  it('marks the connection as AUTHORIZED when B3 lists the CPF', async () => {
    const { useCase, audit, connections } = await createUseCase({ authorized: true })

    const result = await useCase.execute({
      userId,
      requestId: 'req_confirm_1',
      now,
    })

    expect(result).toMatchObject({
      status: 'AUTHORIZED',
      confirmed: true,
      possiblyRevoked: false,
    })
    expect((await connections.findByUserId(userId))?.status).toBe('AUTHORIZED')
    expect(audit.events.some((event) => event.action === 'B3_AUTHORIZATION_CONFIRMED')).toBe(
      true,
    )
  })

  it('keeps AUTHORIZATION_REQUESTED when B3 does not list the CPF', async () => {
    const { useCase, connections } = await createUseCase({ authorized: false })

    const result = await useCase.execute({
      userId,
      requestId: 'req_confirm_2',
      now,
    })

    expect(result).toMatchObject({
      status: 'AUTHORIZATION_REQUESTED',
      confirmed: false,
      possiblyRevoked: false,
    })
    expect((await connections.findByUserId(userId))?.lastCheckedAt).toEqual(now)
  })
})
