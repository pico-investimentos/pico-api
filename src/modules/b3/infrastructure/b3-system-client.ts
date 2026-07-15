import { z } from 'zod'

import type { B3Config } from '../../../config/env.js'
import type { B3SystemClient } from '../domain/b3-system-client.js'
import { requestWithB3AccessToken } from './b3-authenticated-request.js'
import type { B3HttpStack } from './create-b3-http-stack.js'

const loadedDateSchema = z
  .string()
  .superRefine((value, context) => {
    const date = value.slice(0, 10)
    const parsed = new Date(`${date}T00:00:00.000Z`)
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    const isRfc3339 =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      )
    if (
      (!isDateOnly && !isRfc3339) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid B3 last-loaded date',
      })
    }
  })
  .transform((value) => value.slice(0, 10))
const lastLoadItemSchema = z
  .object({
    lastLoadedDate: loadedDateSchema,
  })
  .passthrough()
const systemEnvelopeSchema = z
  .object({
    data: z.union([lastLoadItemSchema, z.array(lastLoadItemSchema).min(1)]),
  })
  .passthrough()

export class HttpB3SystemClient implements B3SystemClient {
  constructor(
    private readonly config: B3Config,
    private readonly stack: B3HttpStack,
  ) {}

  async getLastLoadedDate(): Promise<string> {
    const response = await requestWithB3AccessToken(
      this.stack,
      (accessToken) => ({
        url: `${this.config.apiBaseUrl}/api/system/v1/last-load-update`,
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
        `B3 last-load lookup failed with status ${response.status}`,
      )
    }

    const parsed = systemEnvelopeSchema.safeParse(
      JSON.parse(response.bodyText || '{}'),
    )
    if (!parsed.success) {
      throw new Error('B3 last-load payload does not contain a valid date')
    }
    const payload = parsed.data
    return Array.isArray(payload.data)
      ? payload.data[0]!.lastLoadedDate
      : payload.data.lastLoadedDate
  }
}

export class InMemoryB3SystemClient implements B3SystemClient {
  constructor(private lastLoadedDate = '2026-07-14') {}

  setLastLoadedDate(lastLoadedDate: string): void {
    this.lastLoadedDate = loadedDateSchema.parse(lastLoadedDate)
  }

  async getLastLoadedDate(): Promise<string> {
    return this.lastLoadedDate
  }
}
