import type { B3Config } from '../../../config/env.js'
import type { B3AccessSecrets } from './load-b3-secrets.js'
import { B3HttpTransport } from './b3-http-transport.js'
import { B3TokenProvider } from './b3-token-provider.js'

export type B3HttpStack = Readonly<{
  transport: B3HttpTransport
  tokenProvider: B3TokenProvider
  /** Gateway TLS: strict in production; certification may use B3 test certs. */
  gatewayRejectUnauthorized: boolean
}>

export function createB3HttpStack(
  config: B3Config,
  secrets: B3AccessSecrets,
): B3HttpStack {
  const transport = new B3HttpTransport({
    certificatePem: secrets.certificatePem,
    privateKeyPem: secrets.privateKeyPem,
    timeoutMs: config.httpTimeoutMs,
  })

  const tokenProvider = new B3TokenProvider({
    oauthTokenUrl: config.oauthTokenUrl,
    oauthScope: config.oauthScope,
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
    transport,
  })

  return Object.freeze({
    transport,
    tokenProvider,
    gatewayRejectUnauthorized: config.environment === 'production',
  })
}
