import { describe, expect, it } from 'vitest'

import { StartB3Authorization } from '../src/modules/b3/application/start-b3-authorization.js'
import { hashPassword, hashSha256 } from '../src/shared/crypto/security.js'
import {
  InMemoryAuditRepository,
  InMemoryB3AuthorizationAttemptRepository,
  InMemoryB3ConnectionRepository,
  InMemoryUnitOfWork,
  InMemoryUserRepository,
} from '../src/shared/database/memory-repositories.js'
import { testConfig } from './app.test.js'

const now = new Date('2026-07-10T12:00:00.000Z')
const userId = '11111111-1111-1111-1111-111111111111'

async function createUseCase(options?: {
  cpf?: string | null
  isActive?: boolean
  alreadyAuthorized?: boolean
  seedAttemptKey?: string
}) {
  const users = new InMemoryUserRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })

  users.seed({
    id: userId,
    email: 'cliente@pico.test',
    passwordHash: await hashPassword('password123'),
    cpf: options?.cpf === undefined ? '39053344705' : options.cpf,
    isActive: options?.isActive ?? true,
  })

  if (options?.alreadyAuthorized) {
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
  }

  if (options?.seedAttemptKey) {
    await attempts.createOrGet({
      userId,
      idempotencyKeyHash: hashSha256(options.seedAttemptKey),
      environment: 'certification',
      requestId: 'req_seed',
      now,
    })
  }

  return {
    audit,
    connections,
    useCase: new StartB3Authorization(users, unitOfWork, testConfig.b3),
  }
}

describe('StartB3Authorization', () => {
  it('creates an authorization attempt for an eligible user', async () => {
    const { useCase, audit } = await createUseCase()

    const result = await useCase.execute({
      userId,
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

  it('reuses an attempt for the same idempotency key and audits reuse', async () => {
    const { useCase, audit } = await createUseCase()
    const input = {
      userId,
      idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestId: 'req_2',
      now,
    }

    const first = await useCase.execute(input)
    const second = await useCase.execute(input)

    expect(second.reused).toBe(true)
    expect(second.attemptId).toBe(first.attemptId)
    expect(second.connectionStatus).toBe('AUTHORIZATION_REQUESTED')
    expect(audit.events.some((event) => event.action === 'B3_AUTHORIZATION_REQUEST_REUSED')).toBe(
      true,
    )
  })

  it('rejects already authorized connections even with a reused key', async () => {
    const key = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const { useCase, audit } = await createUseCase({
      alreadyAuthorized: true,
      seedAttemptKey: key,
    })

    await expect(
      useCase.execute({
        userId,
        idempotencyKey: key,
        requestId: 'req_reuse_authorized',
        now,
      }),
    ).rejects.toMatchObject({ code: 'B3_ALREADY_AUTHORIZED', status: 409 })

    expect(
      audit.events.some((event) => event.action === 'B3_AUTHORIZATION_REQUEST_REJECTED'),
    ).toBe(true)
  })

  it('does not downgrade an authorized connection', async () => {
    const { useCase, connections } = await createUseCase({ alreadyAuthorized: true })

    await expect(
      useCase.execute({
        userId,
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        requestId: 'req_no_downgrade',
        now,
      }),
    ).rejects.toMatchObject({ code: 'B3_ALREADY_AUTHORIZED', status: 409 })

    expect((await connections.findByUserId(userId))?.status).toBe('AUTHORIZED')
  })

  it('rejects users without CPF', async () => {
    const { useCase } = await createUseCase({ cpf: null })

    await expect(
      useCase.execute({
        userId,
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        requestId: 'req_3',
        now,
      }),
    ).rejects.toMatchObject({ code: 'CPF_REQUIRED', status: 422 })
  })

  it('rejects invalid CPF', async () => {
    const { useCase } = await createUseCase({ cpf: '11111111111' })

    await expect(
      useCase.execute({
        userId,
        idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        requestId: 'req_4',
        now,
      }),
    ).rejects.toMatchObject({ code: 'CPF_INVALID', status: 422 })
  })

  it('rejects inactive users', async () => {
    const { useCase } = await createUseCase({ isActive: false })

    await expect(
      useCase.execute({
        userId,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        requestId: 'req_5',
        now,
      }),
    ).rejects.toMatchObject({ code: 'USER_NOT_ELIGIBLE', status: 403 })
  })

  it('rejects when the user does not exist', async () => {
    const { useCase } = await createUseCase()

    await expect(
      useCase.execute({
        userId: '99999999-9999-9999-9999-999999999999',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        requestId: 'req_missing_user',
        now,
      }),
    ).rejects.toMatchObject({ code: 'USER_NOT_ELIGIBLE', status: 403 })
  })

  it('rate limits excessive attempts and audits rejection', async () => {
    const { useCase, audit } = await createUseCase()

    for (let index = 0; index < 5; index += 1) {
      await useCase.execute({
        userId,
        idempotencyKey: `00000000-0000-4000-8000-00000000000${index}`,
        requestId: `req_rate_${index}`,
        now,
      })
    }

    await expect(
      useCase.execute({
        userId,
        idempotencyKey: '00000000-0000-4000-8000-000000000099',
        requestId: 'req_rate_overflow',
        now,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS', status: 429 })

    expect(
      audit.events.some(
        (event) =>
          event.action === 'B3_AUTHORIZATION_REQUEST_REJECTED' &&
          event.metadata?.reason === 'TOO_MANY_ATTEMPTS',
      ),
    ).toBe(true)
  })
})
