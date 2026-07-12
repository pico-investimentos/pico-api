import { describe, expect, it } from 'vitest'

import { StartB3Authorization } from '../src/modules/b3/application/start-b3-authorization.js'
import { hashPassword } from '../src/shared/crypto/security.js'
import {
  InMemoryAuditRepository,
  InMemoryB3AuthorizationAttemptRepository,
  InMemoryB3ConnectionRepository,
  InMemoryUnitOfWork,
  InMemoryUserRepository,
} from '../src/shared/database/memory-repositories.js'
import { testConfig } from './app.test.js'

const now = new Date('2026-07-10T12:00:00.000Z')

async function createUseCase(options?: {
  cpf?: string | null
  isActive?: boolean
  alreadyAuthorized?: boolean
}) {
  const users = new InMemoryUserRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })

  users.seed({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'cliente@pico.test',
    passwordHash: await hashPassword('password123'),
    cpf: options?.cpf === undefined ? '39053344705' : options.cpf,
    isActive: options?.isActive ?? true,
  })

  if (options?.alreadyAuthorized) {
    connections.seed({
      id: '22222222-2222-2222-2222-222222222222',
      userId: '11111111-1111-1111-1111-111111111111',
      status: 'AUTHORIZED',
      latestAttemptId: null,
      authorizationRequestedAt: now,
    })
  }

  return {
    audit,
    useCase: new StartB3Authorization(users, attempts, unitOfWork, testConfig.b3),
  }
}

describe('StartB3Authorization', () => {
  it('creates an authorization attempt for an eligible user', async () => {
    const { useCase, audit } = await createUseCase()

    const result = await useCase.execute({
      userId: '11111111-1111-1111-1111-111111111111',
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestId: 'req_1',
      now,
    })

    expect(result).toEqual({
      attemptId: expect.any(String),
      connectionStatus: 'AUTHORIZATION_REQUESTED',
      authorizationUrl: testConfig.b3.optInUrl,
      reused: false,
    })
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]?.action).toBe('B3_AUTHORIZATION_REQUESTED')
    expect(audit.events[0]?.metadata).not.toHaveProperty('cpf')
    expect(audit.events[0]?.metadata).not.toHaveProperty('authorizationUrl')
  })

  it('reuses an attempt for the same idempotency key', async () => {
    const { useCase } = await createUseCase()
    const input = {
      userId: '11111111-1111-1111-1111-111111111111',
      idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestId: 'req_2',
      now,
    }

    const first = await useCase.execute(input)
    const second = await useCase.execute(input)

    expect(second.reused).toBe(true)
    expect(second.attemptId).toBe(first.attemptId)
    expect(second.connectionStatus).toBe('AUTHORIZATION_REQUESTED')
  })

  it('rejects users without CPF', async () => {
    const { useCase } = await createUseCase({ cpf: null })

    await expect(
      useCase.execute({
        userId: '11111111-1111-1111-1111-111111111111',
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        requestId: 'req_3',
        now,
      }),
    ).rejects.toMatchObject({ code: 'CPF_REQUIRED', status: 422 })
  })

  it('rejects invalid CPF', async () => {
    const { useCase } = await createUseCase({ cpf: '11111111111' })

    await expect(
      useCase.execute({
        userId: '11111111-1111-1111-1111-111111111111',
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        requestId: 'req_4',
        now,
      }),
    ).rejects.toMatchObject({ code: 'CPF_INVALID', status: 422 })
  })

  it('rejects inactive users', async () => {
    const { useCase } = await createUseCase({ isActive: false })

    await expect(
      useCase.execute({
        userId: '11111111-1111-1111-1111-111111111111',
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        requestId: 'req_5',
        now,
      }),
    ).rejects.toMatchObject({ code: 'USER_NOT_ELIGIBLE', status: 403 })
  })

  it('rejects already authorized connections', async () => {
    const { useCase } = await createUseCase({ alreadyAuthorized: true })

    await expect(
      useCase.execute({
        userId: '11111111-1111-1111-1111-111111111111',
        idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        requestId: 'req_6',
        now,
      }),
    ).rejects.toMatchObject({ code: 'B3_ALREADY_AUTHORIZED', status: 409 })
  })

  it('rate limits excessive attempts', async () => {
    const { useCase } = await createUseCase()

    for (let index = 0; index < 5; index += 1) {
      await useCase.execute({
        userId: '11111111-1111-1111-1111-111111111111',
        idempotencyKey: `00000000-0000-4000-8000-00000000000${index}`,
        requestId: `req_rate_${index}`,
        now,
      })
    }

    await expect(
      useCase.execute({
        userId: '11111111-1111-1111-1111-111111111111',
        idempotencyKey: '00000000-0000-4000-8000-000000000099',
        requestId: 'req_rate_overflow',
        now,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS', status: 429 })
  })
})
