import type { B3HttpTransport } from './b3-http-transport.js'
import { z } from 'zod'

type TokenCacheEntry = {
  accessToken: string
  expiresAtMs: number
}

/** Process-level cache so cold-start instances still share within the same isolate. */
const processTokenCache = new Map<string, TokenCacheEntry>()
const tokenPayloadSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().max(86_400),
  })
  .passthrough()

export type B3TokenProviderOptions = Readonly<{
  oauthTokenUrl: string
  oauthScope: string
  clientId: string
  clientSecret: string
  transport: B3HttpTransport
  /** Refresh this many ms before expiry (default 60s). */
  refreshSkewMs?: number
  /** Override for tests. */
  cache?: Map<string, TokenCacheEntry>
  now?: () => number
}>

function cacheKey(oauthTokenUrl: string, clientId: string, oauthScope: string): string {
  return `${oauthTokenUrl}\0${clientId}\0${oauthScope}`
}

export class B3TokenProvider {
  private readonly refreshSkewMs: number
  private readonly cache: Map<string, TokenCacheEntry>
  private readonly now: () => number
  private readonly key: string

  constructor(private readonly options: B3TokenProviderOptions) {
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000
    this.cache = options.cache ?? processTokenCache
    this.now = options.now ?? Date.now
    this.key = cacheKey(options.oauthTokenUrl, options.clientId, options.oauthScope)
  }

  async getAccessToken(): Promise<string> {
    const now = this.now()
    const cached = this.cache.get(this.key)
    if (cached && cached.expiresAtMs > now + this.refreshSkewMs) {
      return cached.accessToken
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope: this.options.oauthScope,
    }).toString()

    const response = await this.options.transport.request({
      url: this.options.oauthTokenUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
      useClientCert: false,
      rejectUnauthorized: true,
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`B3 OAuth token request failed with status ${response.status}`)
    }
    const parsed = tokenPayloadSchema.safeParse(
      JSON.parse(response.bodyText || '{}'),
    )
    if (!parsed.success) {
      throw new Error('B3 OAuth token response is invalid')
    }
    const payload = parsed.data

    this.cache.set(this.key, {
      accessToken: payload.access_token,
      expiresAtMs: now + payload.expires_in * 1000,
    })

    return payload.access_token
  }

  invalidate(accessToken?: string): void {
    const cached = this.cache.get(this.key)
    if (!accessToken || cached?.accessToken === accessToken) {
      this.cache.delete(this.key)
    }
  }

  /** Test helper — clears process (or injected) cache. */
  static clearProcessCache(cache: Map<string, TokenCacheEntry> = processTokenCache): void {
    cache.clear()
  }
}
