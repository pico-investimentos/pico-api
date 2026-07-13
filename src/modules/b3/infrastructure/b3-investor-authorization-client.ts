import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { URL } from 'node:url'

import type { B3Config } from '../../../config/env.js'
import type { B3AccessSecrets } from './load-b3-secrets.js'

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

type TokenCache = {
  accessToken: string
  expiresAtMs: number
}

function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    response.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    response.on('error', reject)
  })
}

function httpsJsonRequest(input: {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  cert?: string
  key?: string
  rejectUnauthorized: boolean
}): Promise<{ status: number; bodyText: string }> {
  const url = new URL(input.url)

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: input.headers,
        cert: input.cert,
        key: input.key,
        rejectUnauthorized: input.rejectUnauthorized,
      },
      (response) => {
        void readBody(response)
          .then((bodyText) => {
            resolve({
              status: response.statusCode ?? 0,
              bodyText,
            })
          })
          .catch(reject)
      },
    )

    request.on('error', reject)

    if (input.body) {
      request.write(input.body)
    }

    request.end()
  })
}

export class HttpB3InvestorAuthorizationClient implements B3InvestorAuthorizationClient {
  private tokenCache: TokenCache | null = null

  constructor(
    private readonly config: B3Config,
    private readonly secrets: B3AccessSecrets,
  ) {}

  async healthcheck(): Promise<{ ok: boolean; status: number; bodyText: string }> {
    const accessToken = await this.getAccessToken()
    const response = await httpsJsonRequest({
      url: `${this.config.apiBaseUrl}/api/acesso/healthcheck`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cert: this.secrets.certificatePem,
      key: this.secrets.privateKeyPem,
      rejectUnauthorized: this.config.environment === 'production',
    })

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      bodyText: response.bodyText,
    }
  }

  async findAuthorizationsByDocument(
    documentNumber: string,
  ): Promise<B3AuthorizationLookupResult> {
    const accessToken = await this.getAccessToken()
    const url = new URL(
      `${this.config.apiBaseUrl}/api/authorization-investor/v1/authorizations/investors`,
    )
    url.searchParams.set('documentNumber', documentNumber)

    const response = await httpsJsonRequest({
      url: url.toString(),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cert: this.secrets.certificatePem,
      key: this.secrets.privateKeyPem,
      rejectUnauthorized: this.config.environment === 'production',
    })

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
    const accessToken = await this.getAccessToken()
    const response = await httpsJsonRequest({
      url: `${this.config.apiBaseUrl}/api/authorization-investor/v1/optout/investor/${encodeURIComponent(documentNumber)}`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cert: this.secrets.certificatePem,
      key: this.secrets.privateKeyPem,
      rejectUnauthorized: this.config.environment === 'production',
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`B3 authorization opt-out failed with status ${response.status}`)
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.tokenCache && this.tokenCache.expiresAtMs > now + 60_000) {
      return this.tokenCache.accessToken
    }

    const tokenUrl = this.config.oauthTokenUrl
    const scope = this.config.oauthScope
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.secrets.clientId,
      client_secret: this.secrets.clientSecret,
      scope,
    }).toString()

    const response = await httpsJsonRequest({
      url: tokenUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
      rejectUnauthorized: true,
    })

    const payload = JSON.parse(response.bodyText || '{}') as {
      access_token?: string
      expires_in?: number
    }

    if (response.status < 200 || response.status >= 300 || !payload.access_token) {
      throw new Error(`B3 OAuth token request failed with status ${response.status}`)
    }

    this.tokenCache = {
      accessToken: payload.access_token,
      expiresAtMs: now + (payload.expires_in ?? 3599) * 1000,
    }

    return payload.access_token
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
