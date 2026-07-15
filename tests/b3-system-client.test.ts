import { describe, expect, it, vi } from 'vitest'

import {
  HttpB3SystemClient,
} from '../src/modules/b3/infrastructure/b3-system-client.js'
import type { B3HttpStack } from '../src/modules/b3/infrastructure/create-b3-http-stack.js'
import { testConfig } from './app.test.js'

function createStack(response: {
  status: number
  bodyText: string
}): B3HttpStack {
  return {
    tokenProvider: {
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
    },
    transport: {
      request: vi.fn(async () => response),
    },
    gatewayRejectUnauthorized: false,
  } as unknown as B3HttpStack
}

describe('HttpB3SystemClient', () => {
  it('extracts the B3 last loaded date from a validated envelope', async () => {
    const client = new HttpB3SystemClient(
      testConfig.b3,
      createStack({
        status: 200,
        bodyText: JSON.stringify({
          data: { lastLoadedDate: '2026-07-14T23:10:00-03:00' },
        }),
      }),
    )

    await expect(client.getLastLoadedDate()).resolves.toBe('2026-07-14')
  })

  it('rejects malformed last-load payloads', async () => {
    const client = new HttpB3SystemClient(
      testConfig.b3,
      createStack({
        status: 200,
        bodyText: JSON.stringify({ data: { status: 'ok' } }),
      }),
    )

    await expect(client.getLastLoadedDate()).rejects.toThrow(/valid date/)
  })

  it('rejects dates with unvalidated suffixes', async () => {
    const client = new HttpB3SystemClient(
      testConfig.b3,
      createStack({
        status: 200,
        bodyText: JSON.stringify({
          data: { lastLoadedDate: '2026-07-14-not-a-timestamp' },
        }),
      }),
    )

    await expect(client.getLastLoadedDate()).rejects.toThrow(/valid date/)
  })

  it('rejects non-successful B3 responses', async () => {
    const client = new HttpB3SystemClient(
      testConfig.b3,
      createStack({ status: 503, bodyText: '{}' }),
    )

    await expect(client.getLastLoadedDate()).rejects.toThrow(/status 503/)
  })
})
