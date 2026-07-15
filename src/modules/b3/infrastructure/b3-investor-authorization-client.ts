import type { B3Config } from '../../../config/env.js'
import { requestWithB3AccessToken } from './b3-authenticated-request.js'
import type { B3HttpStack } from './create-b3-http-stack.js'

export type B3AuthorizedInvestor = Readonly<{
  documentNumber: string
  authorizationDatetime: string
}>

export type B3AuthorizationLookupResult = Readonly<{
  authorizedInvestors: readonly B3AuthorizedInvestor[]
}>

export interface B3InvestorAuthorizationClient {
  healthcheck(): Promise<{ ok: boolean; status: number; bodyText: string }>
  findAuthorizationsByDocument(
    documentNumber: string,
  ): Promise<B3AuthorizationLookupResult>
  optOutInvestor(documentNumber: string): Promise<void>
}

export class HttpB3InvestorAuthorizationClient implements B3InvestorAuthorizationClient {
  constructor(
    private readonly config: B3Config,
    private readonly stack: B3HttpStack,
  ) {}

  async healthcheck(): Promise<{ ok: boolean; status: number; bodyText: string }> {
    const response = await requestWithB3AccessToken(
      this.stack,
      (accessToken) => ({
        url: `${this.config.apiBaseUrl}/api/acesso/healthcheck`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        useClientCert: true,
        rejectUnauthorized: this.stack.gatewayRejectUnauthorized,
      }),
    )

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      bodyText: response.bodyText,
    }
  }

  async findAuthorizationsByDocument(
    documentNumber: string,
  ): Promise<B3AuthorizationLookupResult> {
    const url = new URL(
      `${this.config.apiBaseUrl}/api/authorization-investor/v1/authorizations/investors`,
    )
    url.searchParams.set('documentNumber', documentNumber)

    const response = await requestWithB3AccessToken(
      this.stack,
      (accessToken) => ({
        url: url.toString(),
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
        `B3 authorization lookup failed with status ${response.status}`,
      )
    }

    const payload = JSON.parse(response.bodyText || '{}') as {
      data?: { authorizedInvestors?: B3AuthorizedInvestor[] }
    }

    return {
      authorizedInvestors: Object.freeze(payload.data?.authorizedInvestors ?? []),
    }
  }

  async optOutInvestor(documentNumber: string): Promise<void> {
    const response = await requestWithB3AccessToken(
      this.stack,
      (accessToken) => ({
        url: `${this.config.apiBaseUrl}/api/authorization-investor/v1/optout/investor/${encodeURIComponent(documentNumber)}`,
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        useClientCert: true,
        rejectUnauthorized: this.stack.gatewayRejectUnauthorized,
      }),
    )

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`B3 authorization opt-out failed with status ${response.status}`)
    }
  }
}

export class InMemoryB3InvestorAuthorizationClient
  implements B3InvestorAuthorizationClient
{
  private readonly authorizedDocuments: Set<string>

  constructor(authorizedDocuments: ReadonlySet<string> = new Set()) {
    this.authorizedDocuments = new Set(authorizedDocuments)
  }

  async healthcheck() {
    return { ok: true, status: 200, bodyText: '{"status":"Sucesso"}' }
  }

  async findAuthorizationsByDocument(documentNumber: string) {
    if (!this.authorizedDocuments.has(documentNumber)) {
      return { authorizedInvestors: Object.freeze([]) }
    }

    return {
      authorizedInvestors: Object.freeze([
        {
          documentNumber,
          authorizationDatetime: '2026-07-01T12:00:00Z',
        },
      ]),
    }
  }

  async optOutInvestor(documentNumber: string): Promise<void> {
    this.authorizedDocuments.delete(documentNumber)
  }
}
