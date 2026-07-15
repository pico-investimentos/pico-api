import { describe, expect, it } from 'vitest'

import { hashPassword } from '../src/shared/crypto/security.js'
import { createMemoryServices } from '../src/shared/app-services.js'
import {
  InMemoryB3ConnectionRepository,
  InMemoryUserRepository,
} from '../src/shared/database/memory-repositories.js'
import { createTestApp, testConfig } from './app.test.js'

const userId = '11111111-1111-1111-1111-111111111111'

describe('B3 position routes', () => {
  it('returns 202 for a durable request and completes it in the worker', async () => {
    const services = createMemoryServices(testConfig)
    const users = services.users as InMemoryUserRepository
    const connections = services.connections as InMemoryB3ConnectionRepository
    users.seed({
      id: userId,
      email: 'cliente@pico.test',
      passwordHash: await hashPassword('password123'),
      cpf: '39053344705',
      isActive: true,
    })
    connections.seed({
      id: '22222222-2222-2222-2222-222222222222',
      userId,
      status: 'AUTHORIZED',
      latestAttemptId: null,
      authorizationRequestedAt: new Date('2026-07-01T12:00:00Z'),
      authorizedAt: new Date('2026-07-01T12:00:00Z'),
      revokedAt: null,
      lastCheckedAt: new Date('2026-07-01T12:00:00Z'),
    })
    const app = createTestApp(services)
    const loginResponse = await app.request('/api/v1/auth/login', {
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
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? ''

    const syncResponse = await app.request('/api/v1/integrations/b3/syncs', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: cookie,
      },
    })

    expect(syncResponse.status).toBe(202)
    expect(await syncResponse.json()).toMatchObject({
      data: { status: 'PENDING', reused: false },
    })

    const workerResponse = await app.request(
      '/api/v1/internal/b3/process-position-syncs',
      {
        headers: { Authorization: `Bearer ${testConfig.cronSecret}` },
      },
    )
    expect(workerResponse.status).toBe(200)
    expect(await workerResponse.json()).toMatchObject({
      data: {
        claimed: 1,
        results: [{ status: 'SUCCEEDED' }],
      },
    })

    const latestResponse = await app.request(
      '/api/v1/integrations/b3/syncs/latest',
      {
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: cookie,
        },
      },
    )
    expect(await latestResponse.json()).toMatchObject({
      data: { syncRun: { status: 'SUCCEEDED' } },
    })

    const invalidCursor = await app.request(
      '/api/v1/portfolios/positions?cursor=not-a-uuid',
      {
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: cookie,
        },
      },
    )
    expect(invalidCursor.status).toBe(422)
  })
})
