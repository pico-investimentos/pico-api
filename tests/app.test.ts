import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import type { AppConfig } from '../src/config/env.js'
import { createMemoryServices } from '../src/shared/app-services.js'

export const testConfig: AppConfig = Object.freeze({
  nodeEnv: 'test',
  port: 3000,
  appOrigins: Object.freeze(['http://localhost:5173']),
  logLevel: 'silent',
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/pico_test',
  databaseMigrationUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/pico_test',
  sessionCookieName: 'pico_session',
  sessionTtlHours: 168,
  b3: Object.freeze({
    environment: 'certification',
    apiBaseUrl: 'https://apib3i-cert.b3.com.br:2443',
    optInUrl: 'https://b3-optin.test.local/authorize',
    allowedHosts: Object.freeze(['b3-optin.test.local']),
    secretsDir: null,
    oauthTokenUrl:
      'https://login.microsoftonline.com/4bee639f-5388-44c7-bbac-cb92a93911e6/oauth2/v2.0/token',
    oauthScope: '98ddf4b0-f66d-4c96-97ea-9e30306599e7/.default',
  }),
})

export function createTestApp(services = createMemoryServices(testConfig)) {
  return createApp({
    config: testConfig,
    now: () => new Date('2026-07-10T12:00:00.000Z'),
    services,
  })
}

describe('API foundation', () => {
  it('returns the versioned health check', async () => {
    const response = await createTestApp().request('/api/v1/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'pico-investimentos-api',
      version: '0.1.0',
      timestamp: '2026-07-10T12:00:00.000Z',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('uses a consistent response for unknown routes', async () => {
    const response = await createTestApp().request('/api/v1/unknown', {
      headers: { 'X-Request-Id': 'test-request-id' },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Recurso não encontrado.',
        requestId: 'test-request-id',
      },
    })
  })

  it('allows only configured browser origins', async () => {
    const allowedResponse = await createTestApp().request('/api/v1/health', {
      headers: { Origin: 'http://localhost:5173' },
    })
    const deniedResponse = await createTestApp().request('/api/v1/health', {
      headers: { Origin: 'https://example.com' },
    })

    expect(allowedResponse.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    )
    expect(allowedResponse.headers.get('access-control-allow-credentials')).toBe('true')
    expect(deniedResponse.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('rejects cross-site form submissions', async () => {
    const response = await createTestApp().request('/api/v1/health', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Origin: 'https://example.com',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: 'blocked',
    })

    expect(response.status).toBe(403)
  })

  it('limits request bodies to one megabyte', async () => {
    const response = await createTestApp().request('/api/v1/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(1024 * 1024) }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE' },
    })
  })
})
