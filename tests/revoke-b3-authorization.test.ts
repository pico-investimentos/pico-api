import { describe, expect, it } from 'vitest'

import { ConfirmB3Authorization } from '../src/modules/b3/application/confirm-b3-authorization.js'
import { RevokeB3Authorization } from '../src/modules/b3/application/revoke-b3-authorization.js'
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
const password = 'password123'

async function createAuthorizedFixture(authorizedInB3: boolean) {
  const users = new InMemoryUserRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })
  const b3Client = new InMemoryB3InvestorAuthorizationClient(
    authorizedInB3 ? new Set([cpf]) : new Set(),
  )

  users.seed({
    id: userId,
    email: 'cliente@pico.test',
    passwordHash: await hashPassword(password),
    cpf,
    isActive: true,
  })

  connections.seed({
    id: '22222222-2222-2222-2222-222222222222',
    userId,
    status: 'AUTHORIZED',
    latestAttemptId: null,
    authorizationRequestedAt: now,
    authorizedAt: now,
    revokedAt: null,
    lastCheckedAt: null,
  })

  return {
    audit,
    connections,
    b3Client,
    revoke: new RevokeB3Authorization(users, unitOfWork, b3Client, testConfig.b3),
    confirm: new ConfirmB3Authorization(users, unitOfWork, b3Client, testConfig.b3),
  }
}

describe('RevokeB3Authorization', () => {
  it('revokes via B3 opt-out when password is correct', async () => {
    const { revoke, audit, connections, b3Client } = await createAuthorizedFixture(true)

    const result = await revoke.execute({
      userId,
      password,
      requestId: 'req_revoke_1',
      now,
    })

    expect(result.status).toBe('REVOKED')
    expect((await connections.findByUserId(userId))?.status).toBe('REVOKED')
    expect(audit.events.some((event) => event.action === 'B3_AUTHORIZATION_REVOKED')).toBe(true)
    expect((await b3Client.findAuthorizationsByDocument(cpf)).authorizedInvestors).toHaveLength(0)
  })

  it('rejects incorrect password without calling opt-out', async () => {
    const { revoke, connections, b3Client } = await createAuthorizedFixture(true)

    await expect(
      revoke.execute({
        userId,
        password: 'wrong-password',
        requestId: 'req_revoke_2',
        now,
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })

    expect((await connections.findByUserId(userId))?.status).toBe('AUTHORIZED')
    expect((await b3Client.findAuthorizationsByDocument(cpf)).authorizedInvestors).toHaveLength(1)
  })
})

describe('ConfirmB3Authorization possiblyRevoked', () => {
  it('signals possiblyRevoked without demoting AUTHORIZED', async () => {
    const { confirm, connections, audit } = await createAuthorizedFixture(false)

    const result = await confirm.execute({
      userId,
      requestId: 'req_possible_1',
      now,
    })

    expect(result).toMatchObject({
      status: 'AUTHORIZED',
      confirmed: false,
      possiblyRevoked: true,
    })
    expect((await connections.findByUserId(userId))?.status).toBe('AUTHORIZED')
    expect(audit.events.some((event) => event.action === 'B3_AUTHORIZATION_POSSIBLY_REVOKED')).toBe(
      true,
    )
  })
})
