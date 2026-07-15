import type { B3Config } from '../../../config/env.js'
import { z } from 'zod'

import type { B3PositionClient } from '../domain/b3-position-client.js'
import { requestWithB3AccessToken } from './b3-authenticated-request.js'
import type { B3HttpStack } from './create-b3-http-stack.js'
import {
  B3_POSITION_PRODUCTS,
  type B3PositionProduct,
  type PortfolioPositionInput,
} from '../domain/position-types.js'
import {
  extractInstrumentCode,
  extractQuantity,
  hashPositionNaturalKey,
} from '../domain/position-dates.js'

const positionRecordSchema = z.record(z.string(), z.unknown())
const paginationLinksSchema = z
  .object({
    next: z.string().nullable().optional(),
  })
  .passthrough()
const positionPageSchema = z
  .object({
    data: z.union([
      z.array(positionRecordSchema),
      z.record(z.string(), z.unknown()),
    ]),
    Links: paginationLinksSchema.optional(),
    links: paginationLinksSchema.optional(),
  })
  .passthrough()

const PRODUCT_DATA_KEYS: Record<B3PositionProduct, readonly string[]> = {
  equities: ['equities'],
  'fixed-income': ['fixedIncome', 'fixed-income'],
  'treasury-bonds': ['treasuryBonds', 'treasury-bonds'],
  derivatives: ['derivatives'],
  'securities-lending': ['securitiesLending', 'securities-lending'],
}

const PRODUCT_RECORD_CONTRACTS: Record<
  B3PositionProduct,
  {
    identifiers: readonly string[]
    measures: readonly string[]
  }
> = {
  equities: {
    identifiers: ['tickerSymbol', 'ticker', 'isin'],
    measures: ['quantity', 'availableQuantity', 'grossQuantity'],
  },
  'fixed-income': {
    identifiers: ['securityCode', 'assetCode', 'isin', 'productName'],
    measures: ['quantity', 'amount', 'financialValue', 'currentValue'],
  },
  'treasury-bonds': {
    identifiers: ['securityCode', 'assetCode', 'isin', 'productName'],
    measures: ['quantity', 'amount', 'financialValue', 'currentValue'],
  },
  derivatives: {
    identifiers: ['contractCode', 'tickerSymbol', 'assetCode'],
    measures: ['quantity', 'currentQuantity', 'position'],
  },
  'securities-lending': {
    identifiers: ['contractCode', 'tickerSymbol', 'isin'],
    measures: ['quantity', 'currentQuantity', 'settledQuantity'],
  },
}

function validatePositionRecords(
  product: B3PositionProduct,
  records: Record<string, unknown>[],
): Record<string, unknown>[] {
  const contract = PRODUCT_RECORD_CONTRACTS[product]
  for (const record of records) {
    const hasIdentifier = contract.identifiers.some((key) => {
      const value = record[key]
      return typeof value === 'string' && value.trim().length > 0
    })
    const hasMeasure = contract.measures.some((key) => {
      const value = record[key]
      return (
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' &&
          value.trim().length > 0 &&
          Number.isFinite(Number(value)))
      )
    })

    if (!hasIdentifier || !hasMeasure) {
      throw new Error(`B3 position payload has an invalid ${product} record`)
    }
  }

  return records
}

function parsePositionRecords(
  product: B3PositionProduct,
  data: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return validatePositionRecords(
      product,
      z.array(positionRecordSchema).parse(data),
    )
  }

  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>
    const keys = [...PRODUCT_DATA_KEYS[product], 'positions', 'items']
    for (const key of keys) {
      if (Array.isArray(nested[key])) {
        return validatePositionRecords(
          product,
          z.array(positionRecordSchema).parse(nested[key]),
        )
      }
    }
  }

  throw new Error(`B3 position payload missing data array for ${product}`)
}

function resolveNextPageUrl(input: {
  next: string | null | undefined
  currentUrl: string
  initialUrl: string
  apiBaseUrl: string
}): string | null {
  const next = input.next?.trim()
  if (!next) {
    return null
  }

  if (/^https?:\/\//i.test(next) || next.startsWith('/') || next.startsWith('?')) {
    const resolved = new URL(next, input.currentUrl)
    if (resolved.origin !== new URL(input.apiBaseUrl).origin) {
      throw new Error('B3 position pagination returned an unexpected origin')
    }
    return resolved.toString()
  }

  const resolved = new URL(input.initialUrl)
  resolved.searchParams.set('page', next)
  return resolved.toString()
}

export class HttpB3PositionClient implements B3PositionClient {
  constructor(
    private readonly config: B3Config,
    private readonly stack: B3HttpStack,
  ) {}

  async fetchInvestorPositions(input: {
    documentNumber: string
    referenceDate: string
  }): Promise<readonly PortfolioPositionInput[]> {
    const collected: PortfolioPositionInput[] = []

    for (const product of B3_POSITION_PRODUCTS) {
      const items = await this.fetchProductPages({
        product,
        documentNumber: input.documentNumber,
        referenceDate: input.referenceDate,
      })

      for (const item of items) {
        collected.push({
          product,
          naturalKeyHash: hashPositionNaturalKey({
            documentNumber: input.documentNumber,
            product,
            referenceDate: input.referenceDate,
            item,
          }),
          instrumentCode: extractInstrumentCode(item),
          quantity: extractQuantity(item),
          rawPayload: item,
        })
      }
    }

    return Object.freeze(collected)
  }

  private async fetchProductPages(input: {
    product: B3PositionProduct
    documentNumber: string
    referenceDate: string
  }): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = []
    const initialUrl = new URL(
      `${this.config.apiBaseUrl}/api/position/v3/${input.product}/investors/${encodeURIComponent(input.documentNumber)}`,
    )
    initialUrl.searchParams.set('referenceStartDate', input.referenceDate)
    initialUrl.searchParams.set('referenceEndDate', input.referenceDate)
    let currentUrl: string | null = initialUrl.toString()
    let guard = 0

    while (currentUrl) {
      const requestUrl = currentUrl
      guard += 1
      if (guard > 100) {
        throw new Error(`B3 position pagination exceeded page limit for ${input.product}`)
      }

      const response = await requestWithB3AccessToken(
        this.stack,
        (accessToken) => ({
          url: requestUrl,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          useClientCert: true,
          rejectUnauthorized: this.stack.gatewayRejectUnauthorized,
        }),
      )

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `B3 position lookup failed for ${input.product} with status ${response.status}`,
        )
      }

      const payload = positionPageSchema.parse(JSON.parse(response.bodyText || '{}'))
      items.push(...parsePositionRecords(input.product, payload.data))

      currentUrl = resolveNextPageUrl({
        next: payload.Links?.next ?? payload.links?.next,
        currentUrl,
        initialUrl: initialUrl.toString(),
        apiBaseUrl: this.config.apiBaseUrl,
      })
    }

    return items
  }
}

export class InMemoryB3PositionClient implements B3PositionClient {
  failWith: Error | null = null

  constructor(
    private readonly positionsByDocument: Map<string, readonly PortfolioPositionInput[]> = new Map(),
  ) {}

  seed(documentNumber: string, positions: readonly PortfolioPositionInput[]) {
    this.positionsByDocument.set(documentNumber, Object.freeze([...positions]))
  }

  async fetchInvestorPositions(input: {
    documentNumber: string
    referenceDate: string
  }): Promise<readonly PortfolioPositionInput[]> {
    if (this.failWith) {
      throw this.failWith
    }
    return this.positionsByDocument.get(input.documentNumber) ?? Object.freeze([])
  }
}
