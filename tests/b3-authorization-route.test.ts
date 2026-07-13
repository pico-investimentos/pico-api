import { describe, expect, it } from 'vitest'

import { hashPassword } from '../src/shared/crypto/security.js'
import { createMemoryServices } from '../src/shared/app-services.js'
import { InMemoryUserRepository } from '../src/shared/database/memory-repositories.js'
import { createTestApp, testConfig } from './app.test.js'

async function seedServices() {
  const services = createMemoryServices(testConfig)
  const users = services.users as InMemoryUserRepository

  users.seed({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'cliente@pico.test',
    passwordHash: await hashPassword('password123'),
    cpf: '39053344705',
    isActive: true,
  })

  return services
}

async function login(app: ReturnType<typeof createTestApp>) {
  const response = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({
      email: 'cliente@pico.test',
      password: 'password123',
    }),
  })

  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')
  expect(cookie).toContain('pico_session=')
  return cookie ?? ''
}

describe('B3 authorization routes', () => {
  it('returns 401 without a session', async () => {
    const app = createTestApp(await seedServices())
    const response = await app.request('/api/v1/integrations/b3/authorization-attempts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        'Idempotency-Key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    })
  })

  it('returns NOT_CONNECTED when no connection exists', async () => {
    const services = await seedServices()
    const app = createTestApp(services)
    const cookie = await login(app)

    const response = await app.request('/api/v1/integrations/b3/connection', {
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: cookie.split(';')[0] ?? cookie,
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      data: {
        status: 'NOT_CONNECTED',
        authorizationRequestedAt: null,
        authorizedAt: null,
        revokedAt: null,
        lastCheckedAt: null,
      },
    })
  })

  it('ignores userId from the body and creates an attempt from the session', async () => {
    const services = await seedServices()
    const app = createTestApp(services)
    const cookie = await login(app)

    const response = await app.request('/api/v1/integrations/b3/authorization-attempts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: cookie.split(';')[0] ?? cookie,
        'Idempotency-Key': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      body: JSON.stringify({
        userId: '99999999-9999-9999-9999-999999999999',
        cpf: '00000000000',
      }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(await response.json()).toEqual({
      data: {
        attemptId: expect.any(String),
        connectionStatus: 'AUTHORIZATION_REQUESTED',
        authorizationUrl: testConfig.b3.optInUrl,
      },
    })

    const connectionResponse = await app.request('/api/v1/integrations/b3/connection', {
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: cookie.split(';')[0] ?? cookie,
      },
    })

    expect(await connectionResponse.json()).toMatchObject({
      data: { status: 'AUTHORIZATION_REQUESTED' },
    })
  })

  it('returns 200 when the same idempotency key is reused', async () => {
    const services = await seedServices()
    const app = createTestApp(services)
    const cookie = await login(app)
    const headers = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Cookie: cookie.split(';')[0] ?? cookie,
      'Idempotency-Key': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }

    const first = await app.request('/api/v1/integrations/b3/authorization-attempts', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    const second = await app.request('/api/v1/integrations/b3/authorization-attempts', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)

    const firstBody = (await first.json()) as {
      data: { attemptId: string }
    }
    const secondBody = (await second.json()) as {
      data: { attemptId: string }
    }

    expect(secondBody.data.attemptId).toBe(firstBody.data.attemptId)
  })

  it('returns 422 without a valid Idempotency-Key', async () => {
    const services = await seedServices()
    const app = createTestApp(services)
    const cookie = await login(app)

    const response = await app.request('/api/v1/integrations/b3/authorization-attempts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: cookie.split(';')[0] ?? cookie,
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })
  })

  it('returns 429 when the user exceeds the attempt rate limit', async () => {
    const services = await seedServices()
    const app = createTestApp(services)
    const cookie = await login(app)
    const cookieHeader = cookie.split(';')[0] ?? cookie

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request('/api/v1/integrations/b3/authorization-attempts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          Cookie: cookieHeader,
          'Idempotency-Key': `00000000-0000-4000-8000-00000000000${index}`,
        },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(201)
    }

    const limited = await app.request('/api/v1/integrations/b3/authorization-attempts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: cookieHeader,
        'Idempotency-Key': '00000000-0000-4000-8000-000000000099',
      },
      body: JSON.stringify({}),
    })

    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: { code: 'TOO_MANY_ATTEMPTS' },
    })
  })

  it('confirms authorization against the B3 client and returns AUTHORIZED', async () => {
    const services = createMemoryServices(testConfig, {
      authorizedDocuments: new Set(['39053344705']),
    })
    const users = services.users as InMemoryUserRepository
    users.seed({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'cliente@pico.test',
      passwordHash: await hashPassword('password123'),
      cpf: '39053344705',
      isActive: true,
    })

    const app = createTestApp(services)
    const cookie = await login(app)

    const response = await app.request('/api/v1/integrations/b3/connection/confirmation', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: cookie.split(';')[0] ?? cookie,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        status: 'AUTHORIZED',
        confirmed: true,
      },
    })
  })
})
