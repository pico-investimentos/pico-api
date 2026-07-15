import { describe, expect, it, vi } from 'vitest'

import { HttpB3PositionClient } from '../src/modules/b3/infrastructure/b3-position-client.js'
import type { B3HttpStack } from '../src/modules/b3/infrastructure/create-b3-http-stack.js'
import type { B3HttpRequestInput } from '../src/modules/b3/infrastructure/b3-http-transport.js'
import { testConfig } from './app.test.js'

function createStack(
  request: (input: B3HttpRequestInput) => Promise<{ status: number; bodyText: string }>,
): B3HttpStack {
  return {
    tokenProvider: {
      getAccessToken: vi.fn().mockResolvedValue('access-token'),
    },
    transport: { request },
    gatewayRejectUnauthorized: false,
  } as unknown as B3HttpStack
}

describe('HttpB3PositionClient', () => {
  it('rejects 404 instead of interpreting it as an empty portfolio', async () => {
    const stack = createStack(async () => ({ status: 404, bodyText: '{}' }))
    const client = new HttpB3PositionClient(testConfig.b3, stack)

    await expect(
      client.fetchInvestorPositions({
        documentNumber: '33433637822',
        referenceDate: '2026-07-14',
      }),
    ).rejects.toThrow(/equities.*404/)
  })

  it('rejects a successful response with an unknown payload shape', async () => {
    const stack = createStack(async () => ({
      status: 200,
      bodyText: JSON.stringify({ data: { unexpected: 'shape' } }),
    }))
    const client = new HttpB3PositionClient(testConfig.b3, stack)

    await expect(
      client.fetchInvestorPositions({
        documentNumber: '33433637822',
        referenceDate: '2026-07-14',
      }),
    ).rejects.toThrow(/missing data array/)
  })

  it('rejects position records without an identifier and numeric measure', async () => {
    const stack = createStack(async () => ({
      status: 200,
      bodyText: JSON.stringify({ data: [{}] }),
    }))
    const client = new HttpB3PositionClient(testConfig.b3, stack)

    await expect(
      client.fetchInvestorPositions({
        documentNumber: '33433637822',
        referenceDate: '2026-07-14',
      }),
    ).rejects.toThrow(/invalid equities record/)
  })

  it('follows same-origin Links.next URLs without nesting them in page', async () => {
    const requestedUrls: string[] = []
    let equitiesPage = 0
    const request = vi.fn(async (input: B3HttpRequestInput) => {
      requestedUrls.push(input.url)

      if (input.url.includes('/equities/')) {
        equitiesPage += 1
        if (equitiesPage === 1) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              data: [{ tickerSymbol: 'PETR4', quantity: 10 }],
              Links: {
                next:
                  'https://apib3i-cert.b3.com.br:2443/api/position/v3/equities/investors/33433637822?referenceStartDate=2026-07-14&referenceEndDate=2026-07-14&page=2',
              },
            }),
          }
        }
      }

      return { status: 200, bodyText: JSON.stringify({ data: [] }) }
    })
    const client = new HttpB3PositionClient(testConfig.b3, createStack(request))

    const positions = await client.fetchInvestorPositions({
      documentNumber: '33433637822',
      referenceDate: '2026-07-14',
    })

    expect(positions).toHaveLength(1)
    expect(equitiesPage).toBe(2)
    expect(requestedUrls[1]).toContain('page=2')
    expect(requestedUrls[1]).not.toContain('page=https')
    expect(request).toHaveBeenCalledTimes(6)
  })
})
