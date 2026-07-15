import { createServer } from 'node:https'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../src/config/env.js'
import {
  createB3InvestorAuthorizationClient,
} from '../src/shared/app-services.js'
import { B3HttpTransport } from '../src/modules/b3/infrastructure/b3-http-transport.js'
import { B3TokenProvider } from '../src/modules/b3/infrastructure/b3-token-provider.js'
import { requestWithB3AccessToken } from '../src/modules/b3/infrastructure/b3-authenticated-request.js'
import type { B3HttpStack } from '../src/modules/b3/infrastructure/create-b3-http-stack.js'
import {
  InMemoryB3InvestorAuthorizationClient,
} from '../src/modules/b3/infrastructure/b3-investor-authorization-client.js'
import { testConfig } from './app.test.js'

const execFileAsync = promisify(execFile)

function baseConfig(overrides: {
  nodeEnv?: AppConfig['nodeEnv']
  b3?: Partial<AppConfig['b3']>
}): AppConfig {
  return Object.freeze({
    ...testConfig,
    nodeEnv: overrides.nodeEnv ?? testConfig.nodeEnv,
    b3: Object.freeze({
      ...testConfig.b3,
      ...overrides.b3,
    }),
  })
}

describe('createB3InvestorAuthorizationClient fail-closed (F1)', () => {
  it('uses in-memory client in test without secrets', () => {
    const client = createB3InvestorAuthorizationClient(testConfig)
    expect(client).toBeInstanceOf(InMemoryB3InvestorAuthorizationClient)
  })

  it('throws in production when secrets are missing', () => {
    const config = baseConfig({
      nodeEnv: 'production',
      b3: { allowInMemory: true, secretsDir: null },
    })

    expect(() =>
      createB3InvestorAuthorizationClient(config, { env: {} }),
    ).toThrow(/B3 access package required/)
  })

  it('throws in development without secrets and without allow flag', () => {
    const config = baseConfig({
      nodeEnv: 'development',
      b3: { allowInMemory: false, secretsDir: null },
    })

    expect(() =>
      createB3InvestorAuthorizationClient(config, { env: {} }),
    ).toThrow(/B3 access package required/)
  })

  it('allows in-memory in development when B3_ALLOW_INMEMORY is set', () => {
    const config = baseConfig({
      nodeEnv: 'development',
      b3: { allowInMemory: true, secretsDir: null },
    })

    const client = createB3InvestorAuthorizationClient(config, { env: {} })
    expect(client).toBeInstanceOf(InMemoryB3InvestorAuthorizationClient)
  })
})

describe('B3TokenProvider', () => {
  it('reuses cached token across provider instances (process cache)', async () => {
    const cache = new Map()
    const request = vi.fn().mockResolvedValue({
      status: 200,
      bodyText: JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }),
    })

    const transport = { request } as unknown as B3HttpTransport
    const options = {
      oauthTokenUrl: 'https://login.example/token',
      oauthScope: 'scope/.default',
      clientId: 'client',
      clientSecret: 'secret',
      transport,
      cache,
      now: () => 1_000_000,
    }

    const first = new B3TokenProvider(options)
    const second = new B3TokenProvider(options)

    await expect(first.getAccessToken()).resolves.toBe('tok-1')
    await expect(second.getAccessToken()).resolves.toBe('tok-1')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed OAuth token payloads', async () => {
    const tokenProvider = new B3TokenProvider({
      oauthTokenUrl: 'https://login.example/token',
      oauthScope: 'scope/.default',
      clientId: 'client',
      clientSecret: 'secret',
      transport: {
        request: vi.fn().mockResolvedValue({
          status: 200,
          bodyText: JSON.stringify({
            access_token: 'token',
          }),
        }),
      } as unknown as B3HttpTransport,
      cache: new Map(),
    })

    await expect(tokenProvider.getAccessToken()).rejects.toThrow(
      /response is invalid/,
    )
  })

  it('invalidates a rejected cached token and retries one time on 401', async () => {
    let tokenNumber = 0
    const tokenRequest = vi.fn(async () => {
      tokenNumber += 1
      return {
        status: 200,
        bodyText: JSON.stringify({
          access_token: `tok-${tokenNumber}`,
          expires_in: 3600,
        }),
      }
    })
    const tokenProvider = new B3TokenProvider({
      oauthTokenUrl: 'https://login.example/token',
      oauthScope: 'scope/.default',
      clientId: 'client',
      clientSecret: 'secret',
      transport: { request: tokenRequest } as unknown as B3HttpTransport,
      cache: new Map(),
      now: () => 1_000_000,
    })
    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, bodyText: '{}' })
      .mockResolvedValueOnce({ status: 200, bodyText: '{"ok":true}' })
    const stack = {
      tokenProvider,
      transport: { request: apiRequest },
      gatewayRejectUnauthorized: true,
    } as unknown as B3HttpStack

    const response = await requestWithB3AccessToken(stack, (accessToken) => ({
      url: 'https://api.example/resource',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      rejectUnauthorized: true,
    }))

    expect(response.status).toBe(200)
    expect(tokenRequest).toHaveBeenCalledTimes(2)
    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok-1' },
      }),
    )
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok-2' },
      }),
    )
  })
})

describe('B3HttpTransport timeout', () => {
  it('aborts when the server does not respond in time', async () => {
    const { key, cert } = await createSelfSignedPem()

    const server = createServer({ key, cert }, () => {
      // Intentionally never respond — client must time out.
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address')
    }

    const transport = new B3HttpTransport({
      certificatePem: cert,
      privateKeyPem: key,
      timeoutMs: 50,
    })

    await expect(
      transport.request({
        url: `https://127.0.0.1:${address.port}/slow`,
        method: 'GET',
        rejectUnauthorized: false,
      }),
    ).rejects.toThrow(/timed out/)

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })
})

async function createSelfSignedPem(): Promise<{ key: string; cert: string }> {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const keyPem = pair.privateKey

  const dir = await mkdtemp(join(tmpdir(), 'b3-tls-'))
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  await writeFile(keyPath, keyPem)

  try {
    await execFileAsync('openssl', [
      'req',
      '-new',
      '-x509',
      '-key',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ])
    return {
      key: keyPem,
      cert: await readFile(certPath, 'utf8'),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
